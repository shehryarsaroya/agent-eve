#!/usr/bin/env node
// The live connector, end to end, the way ChatGPT, Claude or Muse use it: discovery, read tools
// signed out, the sign-in challenge, dynamic client registration, PKCE, the reviewer's password
// sign-in and approval on the consent flow, the token, then enroll / observe / wake status.
//
//   EVE_REVIEWER_EMAIL=… EVE_REVIEWER_PASSWORD=… node connector/scripts/live-check.mjs
//
// Credentials come from the environment and are never printed. The reviewer's agent is the labelled
// QA principal `eve-review` (connector/SUBMISSION.md §4); its deeds are public like anyone's.
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP = new URL(process.env.EVE_MCP_URL ?? 'https://mcp.agenteve.io/mcp');
const ORIGIN = MCP.origin;
const HANDLE = process.env.EVE_REVIEW_HANDLE ?? 'eve-review';
const email = process.env.EVE_REVIEWER_EMAIL;
const password = process.env.EVE_REVIEWER_PASSWORD;
const REDIRECT = 'http://127.0.0.1:53682/callback';
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const step = (label, detail = '') => console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail) => { console.log(`✗ ${label} — ${detail}`); process.exitCode = 1; };

async function json(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}

async function mcp(token) {
  const client = new Client({ name: 'agenteve-live-check', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(MCP, token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : {});
  await client.connect(transport);
  return client;
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  let value = text;
  try { value = JSON.parse(text); } catch { /* text */ }
  return { isError: r.isError === true, value };
};

// 1. Discovery.
const prm = await json(`${ORIGIN}/.well-known/oauth-protected-resource${MCP.pathname}`);
const prmBody = prm.status === 200 ? prm.body : (await json(`${ORIGIN}/.well-known/oauth-protected-resource`)).body;
const issuer = prmBody?.authorization_servers?.[0];
if (!issuer) { fail('protected resource metadata', JSON.stringify(prmBody).slice(0, 200)); process.exit(1); }
step('protected resource metadata', `resource ${prmBody.resource} · authorization server ${issuer}`);
const asUrl = new URL(issuer);
const asMeta = (await json(`${asUrl.origin}/.well-known/oauth-authorization-server${asUrl.pathname}`)).body;
if (!asMeta?.registration_endpoint || !asMeta.code_challenge_methods_supported?.includes('S256')) fail('authorization server metadata', JSON.stringify(asMeta).slice(0, 300));
else step('authorization server metadata', `DCR ${asMeta.registration_endpoint} · PKCE S256`);

// 2. Signed out: read tools work, account tools ask for sign-in.
const anon = await mcp(null);
const { tools } = await anon.listTools();
step('tools/list', `${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
const unlabelled = tools.filter((t) => !t.title || ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'].some((h) => typeof t.annotations?.[h] !== 'boolean'));
if (unlabelled.length) fail('tool labels', unlabelled.map((t) => t.name).join(', ')); else step('every tool has a title and all four hints');
for (const [name, args] of [['eve_status', {}], ['eve_map', {}], ['eve_rundown', {}], ['eve_dossier', { handle: 'wren' }]]) {
  const r = await call(anon, name, args);
  if (r.isError) fail(`${name} signed out`, JSON.stringify(r.value).slice(0, 200));
  else step(`${name} signed out`, JSON.stringify(r.value).slice(0, 110));
}
await anon.close();
const challenge = await fetch(MCP, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'eve_identity', arguments: {} } }),
});
const wwwAuth = challenge.headers.get('www-authenticate') ?? '';
if (challenge.status === 401 && /resource_metadata=/.test(wwwAuth)) step('account tool signed out → 401 with resource_metadata');
else step('account tool signed out', `HTTP ${challenge.status} ${wwwAuth ? '(WWW-Authenticate set)' : ''} — the in-band form is for ChatGPT`);

if (!email || !password) { console.log('no reviewer credentials in the environment: stopping before sign-in'); process.exit(process.exitCode ?? 0); }

// 3. Dynamic client registration, as a host does.
const reg = await json(asMeta.registration_endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_name: 'Agent Eve live check', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
});
if (!reg.body?.client_id) { fail('dynamic client registration', `HTTP ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`); process.exit(1); }
step('dynamic client registration', `client ${String(reg.body.client_id).slice(0, 8)}…`);

// 4. Authorization request with PKCE; Supabase hands back the consent page with an authorization_id.
const verifier = b64url(randomBytes(32));
const auth = new URL(asMeta.authorization_endpoint);
for (const [k, v] of Object.entries({ response_type: 'code', client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state: b64url(randomBytes(12)), scope: 'openid email', resource: prmBody.resource })) auth.searchParams.set(k, v);
const authRes = await fetch(auth, { redirect: 'manual' });
const consentUrl = authRes.headers.get('location');
const authorizationId = consentUrl ? new URL(consentUrl, ORIGIN).searchParams.get('authorization_id') : null;
if (!authorizationId) { fail('authorization request', `HTTP ${authRes.status} location ${consentUrl}`); process.exit(1); }
step('authorization request → consent page', new URL(consentUrl, ORIGIN).pathname);

// 5. The consent page's own calls: the reviewer's password sign-in, then approve.
const configJs = await (await fetch(`${ORIGIN}/oauth/config.js`)).text();
const supabaseUrl = /["']?supabaseUrl["']?\s*[:=]\s*['"]([^'"]+)['"]/.exec(configJs)?.[1];
const publishable = /["']?supabaseKey["']?\s*[:=]\s*['"]([^'"]+)['"]/.exec(configJs)?.[1];
if (!supabaseUrl || !publishable) { fail('consent page config', 'could not read the project URL and publishable key from /oauth/config.js'); process.exit(1); }
const supabase = createClient(supabaseUrl, publishable, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const signIn = await supabase.auth.signInWithPassword({ email, password });
if (signIn.error) { fail('reviewer password sign-in', signIn.error.message); process.exit(1); }
step('reviewer password sign-in');
const details = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
if (details.error) { fail('authorization details', details.error.message); process.exit(1); }
let redirectUrl = details.data?.redirect_url ?? null;
if (!redirectUrl) {
  const approved = await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (approved.error) { fail('approve', approved.error.message); process.exit(1); }
  redirectUrl = approved.data?.redirect_url ?? approved.data?.redirect_to;
}
const code = redirectUrl ? new URL(redirectUrl).searchParams.get('code') : null;
if (!code) { fail('approval', `no code in ${redirectUrl}`); process.exit(1); }
step('consent approved', 'authorization code issued');

// 6. Token.
const tok = await json(asMeta.token_endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.body.client_id, code_verifier: verifier }),
});
const accessToken = tok.body?.access_token;
if (!accessToken) { fail('token exchange', `HTTP ${tok.status} ${JSON.stringify(tok.body).slice(0, 200)}`); process.exit(1); }
step('token exchange', `access token, refresh ${tok.body.refresh_token ? 'issued' : 'absent'}`);

// 7. Play.
const player = await mcp(accessToken);
for (const [name, args] of [['eve_identity', {}], ['eve_enroll', { handle: HANDLE }], ['eve_wake_status', {}]]) {
  const r = await call(player, name, args);
  if (r.isError) fail(name, JSON.stringify(r.value).slice(0, 300));
  else step(name, JSON.stringify(r.value).slice(0, 160));
}
let observed = await call(player, 'eve_observe');
if (observed.isError || JSON.stringify(observed.value).includes('KEY_NOT_YET_REGISTERED')) {
  step('eve_observe', 'key not registered until the next tick; waiting up to 6 minutes');
  for (let i = 0; i < 24; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    observed = await call(player, 'eve_observe');
    if (!observed.isError && !JSON.stringify(observed.value).includes('KEY_NOT_YET_REGISTERED')) break;
  }
}
if (observed.isError) fail('eve_observe', JSON.stringify(observed.value).slice(0, 300));
else {
  const o = observed.value?.observation ?? observed.value;
  step('eve_observe', `affordances ${o?.affordances?.length ?? '?'} · signer ${o?.header?.standing?.signer ?? '?'} · wakes left ${o?.header?.wakes_remaining ?? o?.wakes_remaining ?? '?'}`);
}
const log = await call(player, 'eve_signing_log', { limit: 5 });
step('eve_signing_log', JSON.stringify(log.value).slice(0, 160));
await player.close();
const dossier = await mcp(null);
const d = await call(dossier, 'eve_dossier', { handle: HANDLE });
step('public dossier', `found ${d.value?.found} · signer ${d.value?.signer ?? d.value?.standing?.signer ?? '?'}`);
await dossier.close();
console.log(process.exitCode ? 'LIVE CHECK FAILED' : 'LIVE CHECK PASSED');
