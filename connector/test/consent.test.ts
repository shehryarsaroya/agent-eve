/**
 * The consent page's logic against a fake supabase-js: sign-in when needed, the authorization
 * details Supabase's OAuth server holds, auto-approval, and approve/deny with the redirect.
 */

import { describe, expect, it } from 'vitest';
import { describeRedirect, isListedCallback, runConsent, safeRedirect, SAME_BROWSER_KEY } from '../public/oauth/consent-flow.mjs';

const PAGE = 'https://mcp.test.example/oauth/consent?authorization_id=auth-123';

interface Recorded {
  readonly calls: unknown[][];
  readonly ui: Record<string, unknown[]>;
  readonly navigated: string[];
}

type Reply = { status: 'waiting' } | { status: 'confirmed'; access_token: string; refresh_token: string } | null;

interface WorldOptions {
  session?: boolean;
  details?: unknown;
  detailsError?: boolean;
  redirect?: string;
  redirectUri?: string;
  account?: { handle: string | null };
  config?: Record<string, unknown>;
  /** Cross-device handoffs: what opening one returns (or throws), and each id's poll replies in turn. */
  handoff?: { open?: (email: string) => unknown; replies?: Record<string, Reply[]> };
  storage?: Map<string, string>;
  /** localStorage: what the confirm page reads when the email is opened in this same browser. */
  shared?: Map<string, string>;
  otpError?: boolean;
  verifyError?: boolean;
}

function fakeWorld(options: WorldOptions = {}) {
  const recorded: Recorded & { polls: string[] } = { calls: [], ui: {}, navigated: [], polls: [] };
  let session: { access_token: string } | null = options.session === false ? null : { access_token: 'session-token' };
  const oauth = {
    getAuthorizationDetails: async (id: string) => {
      recorded.calls.push(['details', id]);
      if (options.detailsError) return { data: null, error: { message: 'authorization not found' } };
      return {
        data: options.details ?? {
          authorization_id: id,
          redirect_uri: options.redirectUri ?? 'https://claude.ai/api/mcp/auth_callback',
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
      setSession: async (tokens: { access_token: string; refresh_token: string }) => {
        recorded.calls.push(['setSession', tokens]);
        session = { access_token: tokens.access_token };
        return { error: null };
      },
      signInWithOtp: async (args: unknown) => (recorded.calls.push(['otp', args]), { error: options.otpError ? { message: 'rate limited' } : null }),
      verifyOtp: async (args: unknown) => {
        recorded.calls.push(['verify', args]);
        if (options.verifyError) return { error: { message: 'expired' } };
        session = { access_token: 'session-token' };
        return { error: null };
      },
      signInWithPassword: async (args: unknown) => {
        recorded.calls.push(['password', args]);
        session = { access_token: 'session-token' };
        return { error: null };
      },
      signInWithOAuth: async (args: unknown) => (recorded.calls.push(['provider', args]), { error: null }),
      signOut: async (args?: unknown) => {
        recorded.calls.push(['signOut', args]);
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
  const handoff = options.handoff
    ? {
        open: async (email: string) => {
          recorded.calls.push(['handoff', email]);
          return options.handoff?.open ? options.handoff.open(email) : { id: 'h1', secret: 's1', word: 'TIGER-42', expires_in: 600 };
        },
        poll: async (id: string, secret: string) => {
          recorded.polls.push(`${id}:${secret}`);
          const queue = options.handoff?.replies?.[id] ?? [];
          return queue.length > 1 ? (queue.shift() as Reply) : (queue[0] ?? null);
        },
      }
    : null;
  const area = (map: Map<string, string> | undefined) =>
    map
      ? {
          getItem: (key: string) => map.get(key) ?? null,
          setItem: (key: string, value: string) => void map.set(key, value),
          removeItem: (key: string) => void map.delete(key),
        }
      : null;
  const storage = area(options.storage);
  const shared = area(options.shared);
  // A clock that moves only when the page sleeps, so a wait that never ends still ends.
  let clock = 0;
  const run = (href = PAGE) =>
    runConsent({
      supabase,
      location: { href },
      navigate: (url: string) => recorded.navigated.push(url),
      fetchAccount: async (token: string) => (recorded.calls.push(['account', token]), options.account ?? { handle: 'brannock' }),
      ui,
      config: { providers: ['github'], passwordSignIn: true, knownRedirectHosts: ['claude.ai', 'chatgpt.com'], gameOrigin: 'https://agenteve.io', ...options.config },
      handoff,
      storage,
      shared,
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
    });
  return { recorded, run, signIn: () => recorded.ui['signIn']?.[0] as SignIn };
}

const AUTO = {
  autoApproveRedirects: ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector/oauth/*', 'https://chatgpt.com/connector_platform_oauth_redirect'],
};
const CONFIRMED: Reply = { status: 'confirmed', access_token: 'phone-access', refresh_token: 'phone-refresh' };

type Consent = { clientName: string; redirect: { host: string; known: boolean; loopback: boolean }; handle: string | null; allow(): Promise<void>; deny(): Promise<void>; switchAccount(): Promise<void> };
type SignIn = { email: string; sendLink(e: string): Promise<void>; verifyCode(e: string, c: string): Promise<void>; password(e: string, p: string): Promise<void>; provider(n: string): Promise<void> };

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

  it('lets the person switch accounts, signing out of this browser only', async () => {
    const { recorded, run } = fakeWorld();
    await run();
    await (recorded.ui['consent']?.[0] as Consent).switchAccount();
    // `global` would also end the sessions behind every app already connected.
    expect(recorded.calls).toContainEqual(['signOut', { scope: 'local' }]);
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

describe('signing in from another device', () => {
  it('emails a link to the confirm page and carries on once the person confirms there', async () => {
    const storage = new Map<string, string>();
    const shared = new Map<string, string>();
    let note: unknown = null;
    const { recorded, run, signIn } = fakeWorld({
      session: false,
      storage,
      shared,
      handoff: {
        replies: { h1: [{ status: 'waiting' }, { status: 'waiting' }, CONFIRMED] },
      },
    });
    await run();
    const waited = signIn().sendLink('player@example.com');
    for (let i = 0; i < 20 && note === null; i++) {
      await Promise.resolve();
      note = shared.has(SAME_BROWSER_KEY) ? JSON.parse(shared.get(SAME_BROWSER_KEY) as string) : null;
    }
    // While it waits, the confirm page in this same browser can read the word.
    expect(note).toEqual({ id: 'h1', word: 'TIGER-42', expiresAt: 600_000 });
    await waited;
    expect(shared.size).toBe(0);
    expect(recorded.calls).toContainEqual(['handoff', 'player@example.com']);
    expect(recorded.calls).toContainEqual(['otp', { email: 'player@example.com', options: { emailRedirectTo: 'https://mcp.test.example/oauth/confirm?handoff=h1', shouldCreateUser: true } }]);
    expect(recorded.ui['linkSent']).toEqual(['player@example.com']);
    expect(recorded.polls).toEqual(['h1:s1', 'h1:s1', 'h1:s1']);
    expect(recorded.calls).toContainEqual(['setSession', { access_token: 'phone-access', refresh_token: 'phone-refresh' }]);
    expect((recorded.ui['consent']?.[0] as Consent).handle).toBe('brannock');
    expect(storage.size).toBe(0);
  });

  it('approves a known platform by itself right after that sign-in', async () => {
    const { recorded, run, signIn } = fakeWorld({ session: false, config: AUTO, handoff: { replies: { h1: [CONFIRMED] } } });
    await run();
    await signIn().sendLink('player@example.com');
    expect(recorded.ui['connecting']).toHaveLength(1);
    expect(recorded.calls).toContainEqual(['approve', 'auth-123', { skipBrowserRedirect: true }]);
    expect(recorded.navigated).toEqual(['https://claude.ai/api/mcp/auth_callback?code=abc&state=s']);
    expect(recorded.ui['consent']).toBeUndefined();
  });

  it('picks the wait back up after a reload, for this request only, keeping the email for the code', async () => {
    const saved = JSON.stringify({ id: 'h1', secret: 's1', word: 'TIGER-42', expires_in: 600, email: 'player@example.com', authorizationId: 'auth-123' });
    const storage = new Map([['eve-handoff', saved]]);
    const { recorded, run } = fakeWorld({ session: false, storage, config: AUTO, handoff: { replies: { h1: [CONFIRMED] } } });
    await run();
    expect(recorded.ui['linkSent']).toEqual(['player@example.com']);
    expect((recorded.ui['signIn']?.[0] as SignIn).email).toBe('player@example.com');
    expect(recorded.navigated).toHaveLength(1);

    const reloaded = fakeWorld({ session: false, storage: new Map([['eve-handoff', saved]]), handoff: { replies: { h1: [{ status: 'waiting' }] } } });
    const waiting = reloaded.run();
    for (let i = 0; i < 20 && !reloaded.recorded.ui['signIn']; i++) await Promise.resolve();
    await reloaded.signIn().verifyCode('', '123456');
    await waiting;
    expect(reloaded.recorded.calls).toContainEqual(['verify', { email: 'player@example.com', token: '123456', type: 'email' }]);

    const elsewhere = new Map([['eve-handoff', saved.replace('auth-123', 'auth-other')]]);
    const other = fakeWorld({ session: false, storage: elsewhere, handoff: { replies: { h1: [CONFIRMED] } } });
    await other.run();
    expect(other.recorded.polls).toEqual([]);
    expect(other.recorded.ui['linkSent']).toBeUndefined();
  });

  it('lets a second email replace the first', async () => {
    let opened = 0;
    const { recorded, run, signIn } = fakeWorld({
      session: false,
      handoff: {
        open: () => (opened++ === 0 ? { id: 'h1', secret: 's1', word: 'TIGER-42', expires_in: 600 } : { id: 'h2', secret: 's2', word: 'RAVEN-17', expires_in: 600 }),
        replies: { h1: [{ status: 'waiting' }], h2: [{ status: 'waiting' }, { status: 'waiting' }, CONFIRMED] },
      },
    });
    await run();
    const first = signIn().sendLink('typo@example.com');
    const second = signIn().sendLink('player@example.com');
    await Promise.all([first, second]);
    expect(recorded.calls.filter((c) => c[0] === 'setSession')).toEqual([['setSession', { access_token: 'phone-access', refresh_token: 'phone-refresh' }]]);
    expect(recorded.polls.filter((p) => p.startsWith('h1')).length).toBeLessThanOrEqual(2);
    expect(recorded.ui['consent']).toHaveLength(1);
    expect(recorded.ui['notice']).toBeUndefined();
  });

  it('stops waiting when the person types the code instead', async () => {
    const storage = new Map<string, string>();
    const { recorded, run, signIn } = fakeWorld({ session: false, storage, handoff: { replies: { h1: [{ status: 'waiting' }] } } });
    await run();
    const waiting = signIn().sendLink('player@example.com');
    await signIn().verifyCode('player@example.com', '123456');
    await waiting;
    expect(recorded.polls.length).toBeLessThanOrEqual(2);
    expect(recorded.ui['notice']).toBeUndefined();
    expect(recorded.ui['consent']).toHaveLength(1);
    expect(storage.size).toBe(0);
  });

  it('says so when the link expires, and falls back to a link to this page without a handoff', async () => {
    const expired = fakeWorld({ session: false, handoff: { replies: { h1: [{ status: 'waiting' }, null] } } });
    await expired.run();
    await expired.signIn().sendLink('player@example.com');
    expect(expired.recorded.ui['notice']?.[0]).toMatch(/expired/);

    const down = fakeWorld({ session: false, handoff: { open: () => Promise.reject(new Error('handoff 503')) } });
    await down.run();
    await down.signIn().sendLink('player@example.com');
    expect(down.recorded.calls).toContainEqual(['otp', { email: 'player@example.com', options: { emailRedirectTo: PAGE, shouldCreateUser: true } }]);
    expect(down.recorded.polls).toEqual([]);

    const unsent = fakeWorld({ session: false, otpError: true, handoff: {} });
    await unsent.run();
    await unsent.signIn().sendLink('player@example.com');
    expect(unsent.recorded.ui['notice']?.[0]).toMatch(/could not be sent/);
    expect(unsent.recorded.polls).toEqual([]);
  });

  it('never signs in from a token in its own URL: anyone can mail a link', async () => {
    const signedOut = fakeWorld({ session: false, config: AUTO });
    await signedOut.run(`${PAGE}&token_hash=pkce_abc&type=email`);
    expect(signedOut.recorded.calls.some((c) => c[0] === 'verify')).toBe(false);
    expect(signedOut.recorded.ui['signIn']).toHaveLength(1);

    const signedIn = fakeWorld({ config: AUTO });
    await signedIn.run(`${PAGE}&token_hash=pkce_abc&type=email`);
    expect(signedIn.recorded.calls.some((c) => c[0] === 'verify' || c[0] === 'approve')).toBe(false);
    expect(signedIn.recorded.ui['consent']).toHaveLength(1);
  });
});

describe('approving without a second click', () => {
  it('never for a session that was already here — someone else\'s link opened later', async () => {
    const { recorded, run } = fakeWorld({ config: AUTO });
    await run();
    expect(recorded.calls.find((c) => c[0] === 'approve')).toBeUndefined();
    expect(recorded.ui['consent']).toHaveLength(1);
  });

  it('only for a listed callback, compared as origin and path exactly', async () => {
    for (const [uri, auto] of [
      ['https://claude.ai/api/mcp/auth_callback', true],
      ['https://claude.ai/api/mcp/auth_callback?from=connector', true],
      ['https://chatgpt.com/connector/oauth/cb_8f3a', true],
      ['https://chatgpt.com/connector_platform_oauth_redirect', true],
      ['https://chatgpt.com/connector/oauth/cb_8f3a/more', false],
      ['https://chatgpt.com/connector/oauth/', false],
      ['https://claude.ai/share/abc', false],
      ['https://evil.claude.ai/api/mcp/auth_callback', false],
      ['https://claude.ai.evil.example/api/mcp/auth_callback', false],
      ['https://user:pw@claude.ai/api/mcp/auth_callback', false],
      ['http://claude.ai/api/mcp/auth_callback', false],
      ['http://localhost:4321/cb', false],
    ] as const) {
      expect([uri, isListedCallback(uri, AUTO.autoApproveRedirects)]).toEqual([uri, auto]);
      const { recorded, run, signIn } = fakeWorld({ session: false, config: AUTO, redirectUri: uri });
      await run();
      await signIn().password('review@example.com', 'pw');
      expect([uri, recorded.calls.some((c) => c[0] === 'approve')]).toEqual([uri, auto]);
      expect([uri, (recorded.ui['consent'] ?? []).length]).toEqual([uri, auto ? 0 : 1]);
    }
  });

  it('not unless the deploy switches it on', async () => {
    const { recorded, run, signIn } = fakeWorld({ session: false });
    await run();
    await signIn().password('review@example.com', 'pw');
    expect(recorded.ui['consent']).toHaveLength(1);
  });

  it('after a provider sign-in that this same request started', async () => {
    const storage = new Map<string, string>();
    const before = fakeWorld({ session: false, storage, config: AUTO });
    await before.run();
    await before.signIn().provider('github');
    expect(storage.get('eve-fresh-sign-in')).toBe('auth-123');
    const back = fakeWorld({ storage, config: AUTO });
    await back.run();
    expect(back.recorded.navigated).toHaveLength(1);
    expect(storage.size).toBe(0);

    const stale = new Map([['eve-fresh-sign-in', 'auth-other']]);
    const later = fakeWorld({ storage: stale, config: AUTO });
    await later.run();
    expect(later.recorded.ui['consent']).toHaveLength(1);
    expect(stale.size).toBe(0);
  });
});
