/**
 * The consent page's logic against a fake supabase-js: sign-in when needed, the authorization
 * details Supabase's OAuth server holds, auto-approval, and approve/deny with the redirect.
 */

import { describe, expect, it } from 'vitest';
import { describeRedirect, runConsent, safeRedirect } from '../public/oauth/consent-flow.mjs';

const PAGE = 'https://mcp.test.example/oauth/consent?authorization_id=auth-123';

interface Recorded {
  readonly calls: unknown[][];
  readonly ui: Record<string, unknown[]>;
  readonly navigated: string[];
}

function fakeWorld(options: { session?: boolean; details?: unknown; detailsError?: boolean; redirect?: string; account?: { handle: string | null } } = {}) {
  const recorded: Recorded = { calls: [], ui: {}, navigated: [] };
  let session: { access_token: string } | null = options.session === false ? null : { access_token: 'session-token' };
  const oauth = {
    getAuthorizationDetails: async (id: string) => {
      recorded.calls.push(['details', id]);
      if (options.detailsError) return { data: null, error: { message: 'authorization not found' } };
      return {
        data: options.details ?? {
          authorization_id: id,
          redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
          client: { id: 'c1', name: 'Claude', uri: 'https://claude.ai' },
          user: { id: 'u1', email: 'player@example.com' },
          scope: 'email',
        },
        error: null,
      };
    },
    approveAuthorization: async (id: string, opts: unknown) => {
      recorded.calls.push(['approve', id, opts]);
      return { data: { redirect_url: options.redirect ?? 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s' }, error: null };
    },
    denyAuthorization: async (id: string, opts: unknown) => {
      recorded.calls.push(['deny', id, opts]);
      return { data: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s' }, error: null };
    },
  };
  const supabase = {
    auth: {
      oauth,
      getSession: async () => ({ data: { session } }),
      signInWithOtp: async (args: unknown) => (recorded.calls.push(['otp', args]), { error: null }),
      verifyOtp: async (args: unknown) => {
        recorded.calls.push(['verify', args]);
        session = { access_token: 'session-token' };
        return { error: null };
      },
      signInWithPassword: async (args: unknown) => {
        recorded.calls.push(['password', args]);
        session = { access_token: 'session-token' };
        return { error: null };
      },
      signInWithOAuth: async (args: unknown) => (recorded.calls.push(['provider', args]), { error: null }),
      signOut: async () => {
        recorded.calls.push(['signOut']);
        session = null;
        return { error: null };
      },
    },
  };
  const ui = new Proxy(
    {},
    {
      get: (_target, name: string) => (arg: unknown) => {
        (recorded.ui[name] ??= []).push(arg);
        return arg;
      },
    },
  );
  const run = (href = PAGE) =>
    runConsent({
      supabase,
      location: { href },
      navigate: (url: string) => recorded.navigated.push(url),
      fetchAccount: async (token: string) => (recorded.calls.push(['account', token]), options.account ?? { handle: 'brannock' }),
      ui,
      config: { providers: ['github'], passwordSignIn: true, knownRedirectHosts: ['claude.ai', 'chatgpt.com'], gameOrigin: 'https://agenteve.io' },
    });
  return { recorded, run };
}

type Consent = { clientName: string; redirect: { host: string; known: boolean; loopback: boolean }; handle: string | null; allow(): Promise<void>; deny(): Promise<void>; switchAccount(): Promise<void> };
type SignIn = { sendLink(e: string): Promise<void>; verifyCode(e: string, c: string): Promise<void>; password(e: string, p: string): Promise<void>; provider(n: string): Promise<void> };

describe('the consent page', () => {
  it('needs an authorization request to start from', async () => {
    const { recorded, run } = fakeWorld();
    await run('https://mcp.test.example/oauth/consent');
    expect(recorded.ui['error']?.[0]).toMatch(/Start from there/);
  });

  it('signs a signed-out person in by email link or code, returning to this same request', async () => {
    const { recorded, run } = fakeWorld({ session: false });
    await run(`${PAGE}&code=stale-pkce-code`);
    const signIn = recorded.ui['signIn']?.[0] as SignIn;
    expect(signIn).toBeTruthy();
    await signIn.sendLink('player@example.com');
    expect(recorded.calls).toContainEqual(['otp', { email: 'player@example.com', options: { emailRedirectTo: PAGE, shouldCreateUser: true } }]);
    expect(recorded.ui['linkSent']).toEqual(['player@example.com']);
    await signIn.verifyCode('player@example.com', '123456');
    expect(recorded.calls).toContainEqual(['verify', { email: 'player@example.com', token: '123456', type: 'email' }]);
    expect((recorded.ui['consent']?.[0] as Consent).handle).toBe('brannock');
  });

  it('offers the enabled providers and reviewer passwords', async () => {
    const { recorded, run } = fakeWorld({ session: false });
    await run();
    const signIn = recorded.ui['signIn']?.[0] as SignIn;
    await signIn.provider('github');
    expect(recorded.calls).toContainEqual(['provider', { provider: 'github', options: { redirectTo: PAGE } }]);
    await signIn.password('review@example.com', 'pw');
    expect(recorded.calls).toContainEqual(['password', { email: 'review@example.com', password: 'pw' }]);
    expect(recorded.ui['consent']).toHaveLength(1);
  });

  it('shows the client, where access goes and the agent, then approves', async () => {
    const { recorded, run } = fakeWorld();
    await run();
    expect(recorded.calls).toContainEqual(['account', 'session-token']);
    const consent = recorded.ui['consent']?.[0] as Consent;
    expect(consent.clientName).toBe('Claude');
    expect(consent.redirect).toMatchObject({ host: 'claude.ai', known: true, loopback: false });
    await consent.allow();
    expect(recorded.calls).toContainEqual(['approve', 'auth-123', { skipBrowserRedirect: true }]);
    expect(recorded.navigated).toEqual(['https://claude.ai/api/mcp/auth_callback?code=abc&state=s']);
  });

  it('denies, sending the person back with access_denied', async () => {
    const { recorded, run } = fakeWorld();
    await run();
    await (recorded.ui['consent']?.[0] as Consent).deny();
    expect(recorded.calls).toContainEqual(['deny', 'auth-123', { skipBrowserRedirect: true }]);
    expect(recorded.navigated[0]).toContain('error=access_denied');
  });

  it('goes straight back when this client was already approved', async () => {
    const { recorded, run } = fakeWorld({ details: { redirect_url: 'https://chatgpt.com/connector/oauth/cb1?code=x' } });
    await run();
    expect(recorded.navigated).toEqual(['https://chatgpt.com/connector/oauth/cb1?code=x']);
    expect(recorded.ui['consent']).toBeUndefined();
  });

  it('refuses an expired request and an unsafe redirect', async () => {
    const expired = fakeWorld({ detailsError: true });
    await expired.run();
    expect(expired.recorded.ui['error']?.[0]).toMatch(/expired/);
    const unsafe = fakeWorld({ redirect: 'javascript:alert(1)' });
    await unsafe.run();
    await (unsafe.recorded.ui['consent']?.[0] as Consent).allow();
    expect(unsafe.recorded.navigated).toEqual([]);
    expect(unsafe.recorded.ui['error']?.[0]).toMatch(/unsafe/);
  });

  it('lets the person switch accounts', async () => {
    const { recorded, run } = fakeWorld();
    await run();
    await (recorded.ui['consent']?.[0] as Consent).switchAccount();
    expect(recorded.calls).toContainEqual(['signOut']);
    expect(recorded.ui['signIn']).toHaveLength(1);
  });

  it('describes loopback and unknown redirect hosts for the warning', () => {
    expect(describeRedirect('http://localhost:53122/callback', [])).toMatchObject({ host: 'localhost', loopback: true });
    expect(describeRedirect('https://evil.example/cb', ['claude.ai'])).toMatchObject({ host: 'evil.example', known: false });
    expect(describeRedirect('https://api.claude.ai/cb', ['claude.ai'])).toMatchObject({ known: true });
    expect(safeRedirect('cursor://anysphere.cursor-mcp/oauth/callback?code=1')).toBe('cursor://anysphere.cursor-mcp/oauth/callback?code=1');
    expect(safeRedirect('data:text/html,hi')).toBeNull();
  });
});
