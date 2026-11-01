alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create schema private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function private.touch_updated_at() from public;
