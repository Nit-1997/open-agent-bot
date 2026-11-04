create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null check (email = lower(email) and char_length(email) <= 254),
  data       jsonb not null default '{}'::jsonb
             check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  status     text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_idx on public.profiles (email);
create index profiles_created_idx on public.profiles (created_at desc, user_id desc);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email))
  on conflict (user_id) do nothing;
  return new;
end $$;

create function private.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where user_id = new.id;
  return new;
end $$;

revoke execute on function private.handle_new_user() from public;
revoke execute on function private.handle_user_email_change() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
