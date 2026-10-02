// Template for /oauth/config.js, which the deploy writes from the Supabase project. Every value
// here is public by design: the project URL and its publishable key are what a browser uses to
// sign in. No secret belongs in this file.
window.EVE_CONSENT = {
  supabaseUrl: 'https://<project-ref>.supabase.co',
  supabaseKey: '<publishable key, sb_publishable_…>',
  // Sign-in options switched on in the Supabase project ('google', 'github').
  providers: [],
  // Reviewer accounts sign in with a password; nobody can sign up with one here.
  passwordSignIn: true,
  // Redirect hosts shown as recognised on the consent screen; others get a warning.
  knownRedirectHosts: ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com'],
  gameOrigin: 'https://agenteve.io',
};
