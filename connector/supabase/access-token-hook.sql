-- Supabase Custom Access Token Hook for the Agent Eve connector's auth project. Two jobs.
--
-- 1. AUDIENCE. Supabase's OAuth 2.1 server accepts RFC 8707's `resource` parameter but issues
--    every access token with `aud: "authenticated"`. MCP (and ChatGPT's auth guide) want a token
--    bound to the MCP server it was requested for. This project serves exactly one resource, so
--    every token issued to an OAuth client (those carry `client_id`), on issue and on refresh, is
--    stamped with that resource as its audience. Sign-in session tokens (no `client_id`) keep
--    `authenticated`, which the consent page needs.
--
-- 2. PASSWORDS ARE FOR REVIEW ACCOUNTS ONLY. With the email provider on, anyone holding the
--    public key can POST /auth/v1/signup with someone else's email and a password of their
--    choosing. Supabase Auth keeps that password through the victim's later email-link
--    confirmation (signupVerify confirms the user and leaves the password set), so the planter
--    could then sign in as the victim and act as their agent. Refusing to mint a session for a
--    password sign-in unless the operator flagged the account (app_metadata, which only the
--    service key can set) makes a planted password worthless. The Password Verification hook
--    would be the natural place, but it is Teams/Enterprise only; this hook runs on every plan.
--
-- The deploy substitutes @RESOURCE@ (e.g. https://mcp.agenteve.io/mcp), runs this through the
-- Management API's SQL endpoint, and points the hook at it:
--   hook_custom_access_token_uri = pg-functions://postgres/public/agenteve_mcp_access_token_hook
--
-- This is auth configuration, not application data: the connector keeps no data in Supabase.

create or replace function public.agenteve_mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
begin
  if coalesce(event ->> 'authentication_method', '') = 'password'
     and coalesce(claims -> 'app_metadata' ->> 'agenteve_password_signin', '') <> 'true' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Password sign-in is only for review accounts. Use the email link or code.'));
  end if;
  if coalesce(claims ->> 'client_id', '') <> '' then
    claims := jsonb_set(claims, '{aud}', to_jsonb('@RESOURCE@'::text));
    event := jsonb_set(event, '{claims}', claims);
  end if;
  return event;
end;
$$;

grant execute on function public.agenteve_mcp_access_token_hook to supabase_auth_admin;
revoke execute on function public.agenteve_mcp_access_token_hook from authenticated, anon, public;
