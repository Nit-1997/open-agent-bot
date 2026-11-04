-- Gate 8 rollback (owner): restores the pre-M7 function bodies, verbatim from the migrations that created them.
-- The M7 tables and functions stay in place, unused.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email))
  on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function private.before_user_created(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if v_email = '' or not exists (select 1 from public.invited_emails where email = v_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Open Agent is invite-only. Request access first.'));
  end if;
  return '{}'::jsonb;
end $$;
comment on function private.before_user_created(jsonb) is null;
