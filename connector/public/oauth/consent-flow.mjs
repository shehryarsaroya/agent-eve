// The consent page's logic, separate from the DOM so it can be tested with fakes.
//
// Supabase's OAuth 2.1 server sends the person here (Site URL + authorization path) with an
// `authorization_id`. What this page MUST do, per Supabase's OAuth server guide:
//   1. read `authorization_id` from the query;
//   2. make sure the person is signed in (here: email link or code, Google/GitHub when enabled,
//      or a password for reviewer accounts), coming back to this same URL afterwards;
//   3. `supabase.auth.oauth.getAuthorizationDetails(id)` — which may answer with a ready
//      `redirect_url` when this person already approved this client for these scopes;
//   4. show the client, where it sends the person back to, and the scopes;
//   5. on a decision, `approveAuthorization(id)` or `denyAuthorization(id)` and go to the
//      `redirect_url` it returns (the code, or `error=access_denied`, plus `state`).
// Everything a client controls (its name, its URIs) is passed to the UI as data; the UI renders
// it with textContent only.

const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:']);

/** Where the tokens go, described for a person: the host, and whether it is their own machine. */
export function describeRedirect(uri, knownHosts = []) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return { host: String(uri), loopback: false, known: false, scheme: 'unknown' };
  }
  const host = url.hostname || url.protocol.replace(/:$/, '');
  const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  const known = knownHosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  return { host, loopback, known, scheme: url.protocol };
}

/** Only navigate where a browser should be sent: never a script or data URL. */
export function safeRedirect(target) {
  try {
    const url = new URL(target);
    return DANGEROUS_SCHEMES.has(url.protocol) ? null : url.href;
  } catch {
    return null;
  }
}

function withoutAuthNoise(href) {
  const url = new URL(href);
  for (const name of ['code', 'error', 'error_code', 'error_description']) url.searchParams.delete(name);
  url.hash = '';
  return url.href;
}

/**
 * Run the page once. Re-run after any sign-in step; it reads its state from the URL and the
 * Supabase session every time, so it never holds a decision in memory across a reload.
 */
export async function runConsent({ supabase, location, navigate, fetchAccount, ui, config }) {
  const here = withoutAuthNoise(location.href);
  const authorizationId = new URL(location.href).searchParams.get('authorization_id');
  const rerun = () => runConsent({ supabase, location, navigate, fetchAccount, ui, config });
  if (!authorizationId) {
    return ui.error('This page opens when you connect Agent Eve from ChatGPT, Claude or another app. Start from there.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session ?? null;
  if (session === null) {
    return ui.signIn({
      providers: config.providers ?? [],
      passwordSignIn: config.passwordSignIn === true,
      sendLink: async (email) => {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: here, shouldCreateUser: true } });
        if (error) return ui.notice('The sign-in email could not be sent. Check the address and try again in a minute.');
        return ui.linkSent(email);
      },
      verifyCode: async (email, code) => {
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) return ui.notice('That code did not work. Codes expire; ask for a new email if needed.');
        return rerun();
      },
      password: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return ui.notice('Those details did not work.');
        return rerun();
      },
      provider: async (name) => {
        const { error } = await supabase.auth.signInWithOAuth({ provider: name, options: { redirectTo: here } });
        if (error) return ui.notice('That sign-in option is not available right now.');
        return undefined;
      },
    });
  }

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return ui.error('This connection request has expired or was already used. Start again from your app.');
  }
  if (!('authorization_id' in data)) {
    // Already approved for this client and these scopes: Supabase hands back the redirect.
    const target = safeRedirect(data.redirect_url);
    return target === null ? ui.error('This app asked to be sent somewhere unsafe.') : navigate(target);
  }

  let account = { handle: null };
  try {
    account = await fetchAccount(session.access_token);
  } catch {
    account = { handle: null };
  }
  const decide = async (approve) => {
    const call = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data: decision, error: decisionError } = await call.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true });
    if (decisionError || !decision) return ui.error('That did not go through. Start again from your app.');
    const target = safeRedirect(decision.redirect_url);
    return target === null ? ui.error('This app asked to be sent somewhere unsafe.') : navigate(target);
  };
  return ui.consent({
    clientName: (data.client && data.client.name) || 'An app',
    clientUri: (data.client && data.client.uri) || null,
    redirect: describeRedirect(data.redirect_uri, config.knownRedirectHosts ?? []),
    scopes: (data.scope || '').split(' ').filter(Boolean),
    email: (data.user && data.user.email) || '',
    handle: account && typeof account.handle === 'string' ? account.handle : null,
    gameOrigin: config.gameOrigin || 'https://agenteve.io',
    allow: () => decide(true),
    deny: () => decide(false),
    switchAccount: async () => {
      await supabase.auth.signOut();
      return rerun();
    },
  });
}
