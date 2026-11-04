-- Gate 8 rollback (owner): restores the pre-M7 function bodies, verbatim from the migrations that created them.
-- The M7 tables and functions stay in place, unused.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email))
  on conflict (user_id) do nothing;
  return new;
end $$;
