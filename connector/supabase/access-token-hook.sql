-- Supabase Custom Access Token Hook for the Agent Eve connector's auth project.
--
-- WHY: Supabase's OAuth 2.1 server accepts RFC 8707's `resource` parameter but issues every
-- access token with `aud: "authenticated"`. MCP (and ChatGPT's auth guide) want the token bound
-- to the MCP server it was requested for. This project serves exactly one resource, so every
-- token issued to an OAuth client (those carry `client_id`) is stamped with that resource as its
-- audience. Sign-in session tokens (no `client_id`) keep `authenticated`, which the consent page
-- needs.
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
  if coalesce(claims ->> 'client_id', '') <> '' then
    claims := jsonb_set(claims, '{aud}', to_jsonb('@RESOURCE@'::text));
    event := jsonb_set(event, '{claims}', claims);
  end if;
  return event;
end;
$$;

grant execute on function public.agenteve_mcp_access_token_hook to supabase_auth_admin;
revoke execute on function public.agenteve_mcp_access_token_hook from authenticated, anon, public;
