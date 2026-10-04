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

/**
 * Whether a redirect URI is one of the listed platform callbacks: compared as origin + path, exactly.
 * An entry ending in `/*` stands for exactly one more path segment (ChatGPT's per-connection
 * `https://chatgpt.com/connector/oauth/{callback_id}`). Query strings never matter; anything else —
 * another path on the same host, a subdomain, http — does not match.
 */
export function isListedCallback(uri, callbacks = []) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const target = `${url.origin}${url.pathname}`;
  return callbacks.some((entry) => {
    if (!entry.endsWith('/*')) return target === entry;
    const prefix = entry.slice(0, -1);
    return target.startsWith(prefix) && /^[A-Za-z0-9._~-]+$/.test(target.slice(prefix.length));
  });
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
  for (const name of ['code', 'error', 'error_code', 'error_description', 'token_hash', 'type']) url.searchParams.delete(name);
  url.hash = '';
  return url.href;
}

const HANDOFF_KEY = 'eve-handoff';
const FRESH_KEY = 'eve-fresh-sign-in';
// In localStorage, shared with the confirm page when the email is opened in this same browser: the
// confirm page then knows the word without asking (public/oauth/confirm-flow.mjs).
export const SAME_BROWSER_KEY = 'eve-handoff-word';

/**
 * Wait for the person to say "Yes, it's me" on the confirm page, on any device. Resolves with the
 * session to adopt, or null when the handoff expired or was refused, when the person signed in here
 * some other way (the code) in the meantime, or when `current()` says a newer link replaced it.
 */
export async function waitForHandoff({ handoff, opened, supabase, sleep, current = () => true, pollMs = 2500, now = () => Date.now() }) {
  const deadline = now() + (opened.expires_in ?? 600) * 1000;
  while (now() < deadline) {
    await sleep(pollMs);
    if (!current()) return null;
    const { data } = await supabase.auth.getSession();
    if (data?.session) return null;
    let reply;
    try {
      reply = await handoff.poll(opened.id, opened.secret);
    } catch {
      continue;
    }
    if (reply === null) return null;
    if (reply.status === 'confirmed' && reply.access_token && reply.refresh_token) {
      return { access_token: reply.access_token, refresh_token: reply.refresh_token };
    }
  }
  return null;
}

/**
 * Run the page once. Re-run after any sign-in step; it reads its state from the URL and the
 * Supabase session every time, so it never holds a decision in memory across a reload.
 *
 * With `handoff`, the email's link opens /oauth/confirm on any device, and this page continues by
 * itself once the person confirms there by typing the word this page shows (src/auth/handoff.ts);
 * the email's code works anywhere too. This page never signs in from a token in its own URL: anyone
 * can mail a link, so a sign-in only ever starts here, in this tab.
 *
 * `fresh` is true when the person signed in during this very request, in this tab (handoff, code,
 * password, or a provider this tab sent them to). Only then may a listed platform callback be
 * approved without a second click: a session that was already here — someone else's connect link
 * opened later — always gets the consent screen.
 */
export async function runConsent(deps) {
  const { supabase, location, navigate, fetchAccount, ui, config, handoff = null, storage = null, shared = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = deps;
  let fresh = deps.fresh === true;
  const here = withoutAuthNoise(location.href);
  const params = new URL(location.href).searchParams;
  const authorizationId = params.get('authorization_id');
  const rerun = (signedInJustNow) => runConsent({ ...deps, fresh: signedInJustNow, location: { href: here } });
  const keep = (area) => ({
    get: (key) => {
      try {
        return area?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        area?.setItem(key, value);
      } catch {
        /* storage unavailable: a reload just asks again */
      }
    },
    remove: (key) => {
      try {
        area?.removeItem(key);
      } catch {
        /* storage unavailable */
      }
    },
  });
  const store = keep(storage);
  const browser = keep(shared);
  if (!authorizationId) {
    return ui.error('This page opens when you connect Agent Eve from ChatGPT, Claude or another app. Start from there.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData?.session ?? null;
  // Back from a provider (GitHub, Google) that this same request sent the person to.
  if (store.get(FRESH_KEY) !== null) {
    if (session !== null && store.get(FRESH_KEY) === authorizationId) fresh = true;
    store.remove(FRESH_KEY);
  }

  if (session === null) {
    let waiting = null;
    const forget = (opened) => {
      store.remove(HANDOFF_KEY);
      try {
        if (JSON.parse(browser.get(SAME_BROWSER_KEY) ?? 'null')?.id === opened.id) browser.remove(SAME_BROWSER_KEY);
      } catch {
        browser.remove(SAME_BROWSER_KEY);
      }
    };
    const adopt = async (opened) => {
      waiting = opened;
      const current = () => waiting === opened;
      const tokens = await waitForHandoff({ handoff, opened, supabase, sleep, now, current });
      if (tokens === null && !current()) return undefined; // a newer email replaced this one
      waiting = null;
      forget(opened);
      if (tokens !== null) {
        const { error } = await supabase.auth.setSession(tokens);
        if (error) return ui.notice('Signing in did not complete. Ask for a new email.');
        return rerun(true);
      }
      const { data } = await supabase.auth.getSession();
      if (data?.session) return undefined; // signed in here another way, which already moved on
      return ui.notice('That sign-in link expired. Ask for a new email.');
    };
    let resumed = null;
    try {
      const saved = handoff ? JSON.parse(store.get(HANDOFF_KEY) ?? 'null') : null;
      if (saved && saved.authorizationId === authorizationId && saved.id && saved.secret) resumed = saved;
    } catch {
      resumed = null;
    }
    // The address the last email went to, so the code still works after a reload (a phone's in-app
    // browser reloads when the person switches to their mail and back).
    let lastEmail = resumed?.email ?? '';
    const shown = ui.signIn({
      providers: config.providers ?? [],
      passwordSignIn: config.passwordSignIn === true,
      email: lastEmail,
      // Resolves once the wait for "Yes, it's me" ends; the page stays usable meanwhile, and a
      // second email replaces the first.
      sendLink: async (email) => {
        let opened = null;
        if (handoff) {
          try {
            opened = await handoff.open(email);
          } catch {
            opened = null;
          }
        }
        const redirectTo = opened ? `${new URL(here).origin}/oauth/confirm?handoff=${encodeURIComponent(opened.id)}` : here;
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
        if (error) return ui.notice('The sign-in email could not be sent. Check the address and try again in a minute.');
        lastEmail = email;
        ui.linkSent(email, opened ? opened.word : null);
        if (opened === null) return undefined;
        store.set(HANDOFF_KEY, JSON.stringify({ id: opened.id, secret: opened.secret, word: opened.word, expires_in: opened.expires_in, email, authorizationId }));
        browser.set(SAME_BROWSER_KEY, JSON.stringify({ id: opened.id, word: opened.word, expiresAt: now() + (opened.expires_in ?? 600) * 1000 }));
        return adopt(opened);
      },
      verifyCode: async (typedEmail, code) => {
        const email = typedEmail || lastEmail;
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) return ui.notice('That code did not work. Codes expire; ask for a new email if needed.');
        // A running wait stops by itself at its next poll (it sees the session), but the page may
        // be on its way to the app by then.
        store.remove(HANDOFF_KEY);
        return rerun(true);
      },
      password: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return ui.notice('Those details did not work.');
        store.remove(HANDOFF_KEY);
        return rerun(true);
      },
      provider: async (name) => {
        store.set(FRESH_KEY, authorizationId);
        const { error } = await supabase.auth.signInWithOAuth({ provider: name, options: { redirectTo: here } });
        if (error) {
          store.remove(FRESH_KEY);
          return ui.notice('That sign-in option is not available right now.');
        }
        return undefined;
      },
    });
    if (resumed !== null) {
      ui.linkSent(resumed.email ?? '', resumed.word ?? null);
      return adopt(resumed);
    }
    return shown;
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

  const decide = async (approve) => {
    const call = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data: decision, error: decisionError } = await call.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true });
    if (decisionError || !decision) return ui.error('That did not go through. Start again from your app.');
    const target = safeRedirect(decision.redirect_url);
    return target === null ? ui.error('This app asked to be sent somewhere unsafe.') : navigate(target);
  };
  // Right after signing in for this request, in this tab, a listed platform callback is approved
  // without a second click: the person asked their app to connect moments ago, and the code can only
  // travel to that platform's own callback. Any other redirect — another path on the same host, a
  // subdomain, the person's own machine — or a session that was already here always gets the screen.
  const redirect = describeRedirect(data.redirect_uri, config.knownRedirectHosts ?? []);
  const autoApprove = fresh && isListedCallback(data.redirect_uri, config.autoApproveRedirects ?? []);
  if (autoApprove) {
    if (typeof ui.connecting === 'function') ui.connecting();
    return decide(true);
  }

  let account = { handle: null };
  try {
    account = await fetchAccount(session.access_token);
  } catch {
    account = { handle: null };
  }
  return ui.consent({
    clientName: (data.client && data.client.name) || 'An app',
    clientUri: (data.client && data.client.uri) || null,
    redirect,
    scopes: (data.scope || '').split(' ').filter(Boolean),
    email: (data.user && data.user.email) || '',
    handle: account && typeof account.handle === 'string' ? account.handle : null,
    gameOrigin: config.gameOrigin || 'https://agenteve.io',
    allow: () => decide(true),
    deny: () => decide(false),
    switchAccount: async () => {
      await supabase.auth.signOut({ scope: 'local' });
      return rerun(false);
    },
  });
}
