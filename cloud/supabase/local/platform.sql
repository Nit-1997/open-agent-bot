-- Local stack only (copied to the temp workdir as supabase/roles.sql, applied before the migrations).
-- Recreates what the hosted Supabase platform puts in every new project and the CLI image lacks:
-- the security-definer event-trigger function public.rls_auto_enable() behind the event trigger
-- ensure_rls, which turns on RLS for every new public table. Migration 1 revokes its EXECUTE grants.
create or replace function public.rls_auto_enable()
returns event_trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
      and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', cmd.object_identity);
  end loop;
end $$;
grant execute on function public.rls_auto_enable() to public, anon, authenticated;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

-- The hosted platform lets service_role (the agent's secret key) read and write every new public table; the CLI image grants it only
-- truncate, references and trigger there. Default privileges, so the migrations stay byte-identical (A13).
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;
