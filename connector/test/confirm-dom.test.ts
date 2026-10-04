// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://mcp.test.example/oauth/confirm?token_hash=pkce_abc&type=email&next=https%3A%2F%2Fmcp.test.example%2Foauth%2Fconfirm%3Fhandoff%3DAbCdEfGhIjKlMnOpQrStUv"}
/**
 * The confirm page's DOM layer (`public/oauth/confirm.js`): it asks for the word (or, in the browser
 * that started the sign-in, just for a tap), checks it before spending the token, hands the session
 * over, and keeps nothing itself.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function load() {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main>';
  const calls: unknown[][] = [];
  const client = {
    auth: {
      verifyOtp: async (args: unknown) => (calls.push(['verify', args]), { data: { session: { access_token: 'phone-access', refresh_token: 'phone-refresh' } }, error: null }),
    },
  };
  const createClient = vi.fn(() => client);
  Object.assign(window, { EVE_CONSENT: { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'sb_publishable_test' }, supabase: { createClient } });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(['fetch', url, init?.method ?? 'GET', (init?.headers as Record<string, string> | undefined)?.['authorization'] ?? null, init?.body ?? null]);
    const body = url.endsWith('/check') || url.endsWith('/confirm') ? { ok: true } : { pending: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  await import('../public/oauth/confirm.js');
  await settle();
  return { calls, createClient };
}

describe('the confirm page in a browser', () => {
  beforeEach(() => window.localStorage.clear());

  it('on another device, asks for the word, then signs in and hands the session over', async () => {
    const { calls, createClient } = await load();
    expect(createClient).toHaveBeenCalledWith('https://x.supabase.co', 'sb_publishable_test', { auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }) });
    expect(document.querySelector('h1')?.textContent).toBe("Confirm it's you");
    const word = document.querySelector<HTMLInputElement>('#word') as HTMLInputElement;
    expect(word).not.toBeNull();
    expect(calls.some((c) => c[0] === 'verify')).toBe(false);

    word.value = 'tiger';
    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(calls).toContainEqual(['fetch', `/oauth/handoff/${ID}/check`, 'POST', null, JSON.stringify({ word: 'tiger' })]);
    expect(calls).toContainEqual(['verify', { token_hash: 'pkce_abc', type: 'email' }]);
    expect(calls).toContainEqual(['fetch', `/oauth/handoff/${ID}/confirm`, 'POST', 'Bearer phone-access', JSON.stringify({ refresh_token: 'phone-refresh', word: 'tiger' })]);
    expect(document.querySelector('h1')?.textContent).toBe("You're signed in");
  });

  it('in the browser that started the sign-in, needs only a tap', async () => {
    window.localStorage.setItem('eve-handoff-word', JSON.stringify({ id: ID, word: 'TIGER', expiresAt: Date.now() + 60_000 }));
    const { calls } = await load();
    expect(document.querySelector('#word')).toBeNull();
    expect([...document.querySelectorAll('button')].map((b) => b.textContent)).toEqual(["Yes, it's me", 'Cancel']);
    document.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(calls).toContainEqual(['fetch', `/oauth/handoff/${ID}/check`, 'POST', null, JSON.stringify({ word: 'TIGER' })]);
    expect(document.querySelector('h1')?.textContent).toBe("You're signed in");
    expect(window.localStorage.getItem('eve-handoff-word')).toBeNull();
  });
});
