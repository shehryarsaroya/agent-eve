// Template for /oauth/config.js, which the deploy writes from the Supabase project. Every value
// here is public by design: the project URL and its publishable key are what a browser uses to
// sign in. No secret belongs in this file.
window.EVE_CONSENT = {
  supabaseUrl: 'https://<project-ref>.supabase.co',
  supabaseKey: '<publishable key, sb_publishable_…>',
  // Sign-in options switched on in the Supabase project ('google', 'github').
  providers: [],
  // Shows the password box for review accounts. A password sign-in mints a session only for an
  // account the operator flagged (app_metadata.agenteve_password_signin, set by the deploy with the
  // service key); the access-token hook refuses every other one (supabase/access-token-hook.sql).
  passwordSignIn: true,
  // Redirect hosts shown as recognised on the consent screen; others get a warning.
  knownRedirectHosts: ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com'],
  // Platform callbacks approved without a second click (origin + path exactly; `/*` is one more path
  // segment), and only right after the person signed in for that same request in that tab; everything
  // else gets the consent screen (consent-flow.mjs isListedCallback).
  autoApproveRedirects: ['https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector/oauth/*'],
  gameOrigin: 'https://agenteve.io',
};
