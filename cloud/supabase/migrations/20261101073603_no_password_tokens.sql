-- The app signs people in with Google, invites and email links only. Refusing every token that a
-- password produced means a password set with a stolen access token never becomes a credential.
create function private.custom_access_token(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if event->>'authentication_method' = 'password'
     or exists (select 1 from jsonb_array_elements(coalesce(event->'claims'->'amr', '[]'::jsonb)) m where m->>'method' = 'password') then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Password sign-in is turned off. Use Google or an email link.'));
  end if;
  return event;
end;
$$;
revoke execute on function private.custom_access_token(jsonb) from public, anon, authenticated;
grant execute on function private.custom_access_token(jsonb) to supabase_auth_admin;
