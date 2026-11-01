create table public.access_requests (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 100),
  email         text not null check (
                  email = lower(email) and char_length(email) <= 254
                  and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  note          text not null default '' check (char_length(note) <= 1000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  invite_status text check (invite_status in ('sent', 'failed')),
  invite_error  text check (char_length(invite_error) <= 500),
  ip_hash       bytea not null check (octet_length(ip_hash) = 32),
  user_id       uuid references auth.users(id) on delete set null,
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check (invite_status is null or status = 'approved')
);
create unique index access_requests_one_pending on public.access_requests (email) where status = 'pending';
create index access_requests_status_created_idx on public.access_requests (status, created_at desc, id desc);
create index access_requests_created_idx on public.access_requests (created_at desc, id desc);
create index access_requests_ip_created_idx on public.access_requests (ip_hash, created_at desc);
create index access_requests_email_idx on public.access_requests (email);
create index access_requests_user_idx on public.access_requests (user_id);
create index access_requests_decided_by_idx on public.access_requests (decided_by);

alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon, authenticated;

create table public.invited_emails (
  email      text primary key check (email = lower(email) and char_length(email) <= 254),
  request_id uuid references public.access_requests(id) on delete set null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index invited_emails_request_idx on public.invited_emails (request_id);
create index invited_emails_invited_by_idx on public.invited_emails (invited_by);
alter table public.invited_emails enable row level security;
revoke all on public.invited_emails from anon, authenticated;
grant select on public.invited_emails to supabase_auth_admin;
create policy invited_emails_auth_admin_read on public.invited_emails
  for select to supabase_auth_admin using (true);

create function private.before_user_created(event jsonb)
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
revoke execute on function private.before_user_created(jsonb) from public;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;

create function public.access_request_submit(
  p_name text, p_email text, p_note text, p_ip_hash bytea
) returns text language plpgsql set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
begin
  perform pg_advisory_xact_lock(hashtext('access_request_submit'));
  if (select count(*) from public.access_requests
       where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.access_requests
       where ip_hash = p_ip_hash and created_at > now() - interval '1 day') >= 10 then
    return 'rate_limited_ip';
  end if;
  if (select count(*) from public.access_requests
       where created_at > now() - interval '1 day') >= 200 then
    return 'rate_limited_global';
  end if;
  if exists (select 1 from public.profiles where email = v_email) then
    return 'already_member';
  end if;
  if exists (select 1 from public.access_requests where email = v_email and status = 'pending') then
    return 'duplicate';
  end if;
  insert into public.access_requests (name, email, note, ip_hash)
  values (btrim(p_name), v_email, p_note, p_ip_hash);
  return 'inserted';
end $$;
revoke execute on function public.access_request_submit(text, text, text, bytea) from public, anon, authenticated;
grant execute on function public.access_request_submit(text, text, text, bytea) to service_role;
