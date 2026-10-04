#!/usr/bin/env node
// The live cross-device sign-in, end to end against production (connector/README.md §1, "The email
// link works on any device"): the confirm page and its headers, a handoff opened (and refused to
// another site), the word never readable without the popup's secret, a wrong word counted, a real
// Supabase sign-in session confirmed with the word, the popup's poll collecting it once, and an email
// mismatch refused. With SUPABASE_ACCESS_TOKEN it also proves the email's own link: a magic
// link generated (never sent) for the reviewer, its redirect accepted by the allow-list, and its
// token hash spent with `type=email` exactly as the confirm page spends it.
//
//   EVE_REVIEWER_EMAIL=… EVE_REVIEWER_PASSWORD=… [SUPABASE_ACCESS_TOKEN=…] node connector/scripts/live-handoff-check.mjs
//
// Credentials come from the environment and are never printed; neither are tokens or codes.
import { createClient } from '@supabase/supabase-js';

const ORIGIN = process.env.EVE_MCP_ORIGIN ?? 'https://mcp.agenteve.io';
const email = process.env.EVE_REVIEWER_EMAIL;
const password = process.env.EVE_REVIEWER_PASSWORD;
const managementToken = process.env.SUPABASE_ACCESS_TOKEN;
const step = (label, detail = '') => console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail) => {
  console.log(`✗ ${label} — ${detail}`);
  process.exitCode = 1;
};

async function json(url, init) {
  const res = await fetch(url, { ...init, cache: 'no-store' });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body };
}

// 1. The confirm page: served only by its path, with the consent page's headers.
const page = await fetch(`${ORIGIN}/oauth/confirm?token_hash=x&type=email`, { cache: 'no-store' });
const csp = page.headers.get('content-security-policy') ?? '';
const html = await page.text();
if (page.status === 200 && csp.includes("frame-ancestors 'none'") && page.headers.get('x-frame-options') === 'DENY' && html.includes('/oauth/confirm.js')) {
  step('/oauth/confirm', 'served with CSP, frame denial and its script');
} else fail('/oauth/confirm', `HTTP ${page.status}, csp ${csp ? 'set' : 'missing'}`);
const direct = await fetch(`${ORIGIN}/oauth/confirm.html`, { cache: 'no-store' });
if (direct.status === 404) step('/oauth/confirm.html is not reachable by its file name');
else fail('/oauth/confirm.html', `HTTP ${direct.status}`);
for (const path of ['/oauth/confirm.js', '/oauth/confirm-flow.mjs', '/oauth/consent-flow.mjs']) {
  const res = await fetch(`${ORIGIN}${path}`, { cache: 'no-store' });
  const type = res.headers.get('content-type') ?? '';
  if (res.status === 200 && type.includes('javascript')) step(path, type);
  else fail(path, `HTTP ${res.status} ${type}`);
}
const configText = await (await fetch(`${ORIGIN}/oauth/config.js`, { cache: 'no-store' })).text();
const pick = (name) => new RegExp(`["']?${name}["']?\\s*[:=]\\s*['"]([^'"]+)['"]`).exec(configText)?.[1] ?? null;
const supabaseUrl = pick('supabaseUrl');
const supabaseKey = pick('supabaseKey');
const autoApprove = /autoApproveRedirects/.test(configText) && configText.includes('https://claude.ai/api/mcp/auth_callback');
if (supabaseUrl && supabaseKey && autoApprove) step('/oauth/config.js', `Supabase ${supabaseUrl}; auto-approved callbacks listed`);
else fail('/oauth/config.js', 'missing supabaseUrl, supabaseKey or autoApproveRedirects');

// 2. A handoff, as the consent page opens it.
const post = (path, body, headers = {}) =>
  json(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) });
const open = (address) => post('/oauth/handoff', { email: address });
const poll = (id, secret) => json(`${ORIGIN}/oauth/handoff/${id}`, { headers: secret ? { 'x-handoff-secret': secret } : {} });
const check = (id, word) => post(`/oauth/handoff/${id}/check`, { word });
const confirm = (id, session, word) => post(`/oauth/handoff/${id}/confirm`, { refresh_token: session.refresh_token, word }, { authorization: `Bearer ${session.access_token}` });

const foreign = await post('/oauth/handoff', { email: 'nobody@agenteve.io' }, { origin: 'https://evil.example' });
if (foreign.status === 403) step('another site cannot open a handoff');
else fail('foreign origin', `HTTP ${foreign.status}`);

if (!email || !password) {
  console.log('no reviewer credentials in the environment: stopping before sign-in');
  process.exit(process.exitCode ?? 0);
}

const opened = await open(email);
if (opened.status !== 201 || !opened.body?.id || !opened.body?.secret) {
  fail('POST /oauth/handoff', `HTTP ${opened.status} ${JSON.stringify(opened.body).slice(0, 120)}`);
  process.exit(1);
}
const { id, secret, word, expires_in: expiresIn } = opened.body;
step('POST /oauth/handoff', `word ${word}, lifetime ${expiresIn}s`);
const shown = await poll(id);
if (shown.status === 200 && shown.body?.pending === true && !JSON.stringify(shown.body).includes(word)) step('the confirm page learns only that it is pending, never the word');
else fail('GET /oauth/handoff/<id>', JSON.stringify(shown.body));
const waiting = await poll(id, secret);
if (waiting.body?.status === 'waiting') step('the popup polls: waiting');
else fail('poll before confirming', JSON.stringify(waiting.body));
const guessed = await check(id, 'NOTAWORD');
if (guessed.status === 422 && guessed.body?.tries_left === 1) step('a wrong word is refused, one try left');
else fail('wrong word', `HTTP ${guessed.status} ${JSON.stringify(guessed.body)}`);
const typed = await check(id, ` ${word.toLowerCase()} `);
if (typed.status === 200) step('the right word, typed loosely, is accepted');
else fail('right word', `HTTP ${typed.status} ${JSON.stringify(typed.body)}`);

// 3. "Yes, it's me" with a real sign-in session (the reviewer's password stands in for the email
// link here; step 5 spends a real link).
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const signedIn = await supabase.auth.signInWithPassword({ email, password });
const session = signedIn.data?.session;
if (!session) {
  fail('reviewer sign-in', signedIn.error?.message ?? 'no session');
  process.exit(1);
}
step('reviewer signed in', 'a sign-in session (no client_id)');
const confirmed = await confirm(id, session, word);
if (confirmed.status === 200) step('POST /oauth/handoff/<id>/confirm', 'accepted');
else fail('confirm', `HTTP ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
const again = await confirm(id, session, word);
if (again.status === 409) step('a second confirmation is refused');
else fail('second confirmation', `HTTP ${again.status}`);
const taken = await poll(id, secret);
if (taken.body?.status === 'confirmed' && taken.body.access_token === session.access_token && taken.body.refresh_token === session.refresh_token) {
  step('the popup collects the session', 'the same tokens, once');
} else fail('collect', JSON.stringify({ status: taken.status, body: taken.body?.status }));
const gone = await poll(id, secret);
if (gone.status === 404) step('…and only once');
else fail('collect twice', `HTTP ${gone.status}`);

// 4. A session for another email cannot answer someone's handoff.
const other = await open('nobody@agenteve.io');
const mismatch = other.body?.id ? await confirm(other.body.id, session, other.body.word) : { status: 0, body: null };
if (mismatch.status === 409 && mismatch.body?.error === 'email_mismatch') step('a session for another email is refused');
else fail('email mismatch', `HTTP ${mismatch.status} ${JSON.stringify(mismatch.body)}`);

// Each check ends its own sessions (this browser-equivalent only; the reviewer's other sessions stay).
const logout = (accessToken) =>
  json(`${supabaseUrl}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: supabaseKey, authorization: `Bearer ${accessToken}` } });
await logout(session.access_token);

// 5. The email's own link: generated, not sent, then spent the way the confirm page spends it.
if (!managementToken) {
  console.log('no SUPABASE_ACCESS_TOKEN in the environment: skipping the magic-link check');
  process.exit(process.exitCode ?? 0);
}
const ref = new URL(supabaseUrl).hostname.split('.')[0];
const keys = await json(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: { authorization: `Bearer ${managementToken}` } });
const service = Array.isArray(keys.body) ? (keys.body.find((k) => k.type === 'secret') ?? keys.body.find((k) => k.name === 'service_role'))?.api_key : null;
if (!service) {
  fail('service key', `HTTP ${keys.status}`);
  process.exit(1);
}
const admin = service.startsWith('sb_secret_') ? { apikey: service } : { apikey: service, authorization: `Bearer ${service}` };
const linkHandoff = (await open(email)).body;
const redirectTo = `${ORIGIN}/oauth/confirm?handoff=${encodeURIComponent(linkHandoff.id)}`;
const link = await json(`${supabaseUrl}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { ...admin, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirectTo }),
});
if (link.status !== 200 || !link.body?.hashed_token) {
  fail('generate_link', `HTTP ${link.status}`);
  process.exit(1);
}
if (link.body.redirect_to === redirectTo) step('the allow-list accepts the confirm page as the link\'s destination');
else fail('redirect allow-list', `Supabase would send the person to ${link.body.redirect_to}`);
const verified = await json(`${supabaseUrl}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: supabaseKey, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'email', token_hash: link.body.hashed_token }),
});
if (verified.status === 200 && verified.body?.access_token && verified.body?.refresh_token) step('the link\'s token hash, spent with type=email, signs in');
else fail('verify token_hash', `HTTP ${verified.status} ${JSON.stringify(verified.body?.msg ?? verified.body?.error_code ?? '')}`);
const reused = await json(`${supabaseUrl}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: supabaseKey, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'email', token_hash: link.body.hashed_token }),
});
if (reused.status >= 400) step('…and only once', `a second use is refused (HTTP ${reused.status})`);
else fail('token hash reuse', `HTTP ${reused.status}`);
if (verified.body?.access_token) {
  const handed = await confirm(linkHandoff.id, verified.body, linkHandoff.word);
  const collected = await poll(linkHandoff.id, linkHandoff.secret);
  if (handed.status === 200 && collected.body?.status === 'confirmed') step('that session completes a handoff the same way');
  else fail('handoff from a link session', `confirm HTTP ${handed.status}, poll ${collected.body?.status}`);
  await logout(verified.body.access_token);
}
const settings = await json(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { authorization: `Bearer ${managementToken}` } });
const templates = [settings.body?.mailer_templates_magic_link_content, settings.body?.mailer_templates_confirmation_content];
if (templates.every((t) => typeof t === 'string' && t.includes('/oauth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}'))) {
  step('both sign-in email templates link to the confirm page');
} else fail('email templates', 'the magic-link or confirmation template does not link to /oauth/confirm');
process.exit(process.exitCode ?? 0);
