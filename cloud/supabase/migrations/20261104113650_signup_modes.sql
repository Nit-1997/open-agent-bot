create table public.signup_settings (
  id                 boolean primary key default true check (id),
  mode               text not null default 'waitlist' check (mode in ('invite', 'waitlist', 'open')),
  signups_per_hour   int not null default 20 check (signups_per_hour between 1 and 10000),
  signups_per_day    int not null default 100 check (signups_per_day between 1 and 100000),
  signups_per_ip_day int not null default 3 check (signups_per_ip_day between 1 and 1000),
  updated_at         timestamptz not null default now()
);
insert into public.signup_settings default values;

create table public.blocked_email_domains (
  domain text primary key check (domain = lower(domain) and domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$')
);

create table private.signups (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  ip_hash bytea check (octet_length(ip_hash) = 32)
);
create index signups_at_idx on private.signups (at);
create index signups_ip_at_idx on private.signups (ip_hash, at);

alter table public.signup_settings enable row level security;
alter table public.blocked_email_domains enable row level security;
revoke all on public.signup_settings, public.blocked_email_domains from anon, authenticated, service_role;
revoke all on private.signups from public, anon, authenticated, service_role, authenticator;

grant select on public.signup_settings, public.blocked_email_domains to supabase_auth_admin;
create policy signup_settings_auth_admin_read on public.signup_settings
  for select to supabase_auth_admin using (true);
create policy blocked_email_domains_auth_admin_read on public.blocked_email_domains
  for select to supabase_auth_admin using (true);
grant select, insert, delete on private.signups to supabase_auth_admin;
grant select on private.signup_pepper to supabase_auth_admin;

create or replace function private.before_user_created(event jsonb)
returns jsonb language plpgsql volatile set search_path = '' as $$
declare
  v_email    text := lower(coalesce(event -> 'user' ->> 'email', ''));
  v_ip       text := lower(left(btrim(coalesce(event -> 'metadata' ->> 'ip_address', '')), 64));
  v_domain   text;
  v_settings public.signup_settings%rowtype;
  v_hash     bytea;
begin
  perform pg_advisory_xact_lock(hashtext('before_user_created'));
  if v_email <> '' and exists (select 1 from public.invited_emails where email = v_email) then
    return '{}'::jsonb;
  end if;
  select * into v_settings from public.signup_settings s where s.id;
  if not found or v_settings.mode <> 'open' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Open Agent is invite-only. Request access first.'));
  end if;
  if coalesce(event #>> '{user,app_metadata,provider}', '') <> 'google' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Create your account with Google.'));
  end if;
  v_domain := substring(v_email from '@([^@]+)$');
  if v_domain is null or exists (
    select 1 from public.blocked_email_domains b
    where b.domain in (
      select array_to_string(p.parts[i:], '.')
      from (select string_to_array(v_domain, '.') as parts) p, generate_subscripts(p.parts, 1) i
    )
  ) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Use a permanent email address.'));
  end if;
  if (select count(*) from private.signups g where g.at > now() - interval '1 hour') >= v_settings.signups_per_hour
     or (select count(*) from private.signups g where g.at > now() - interval '1 day') >= v_settings.signups_per_day then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'Sign-ups are paused for a bit. Try again later.'));
  end if;
  if v_ip <> '' then
    select sha256(convert_to(v_ip, 'UTF8') || s.pepper) into v_hash from private.signup_pepper s;
    if (select count(*) from private.signups g where g.ip_hash = v_hash and g.at > now() - interval '1 day')
       >= v_settings.signups_per_ip_day then
      return jsonb_build_object('error', jsonb_build_object(
        'http_code', 429,
        'message', 'Sign-ups are paused for a bit. Try again later.'));
    end if;
  end if;
  insert into private.signups (ip_hash) values (v_hash);
  delete from private.signups g where g.at < now() - interval '2 days';
  return '{}'::jsonb;
end $$;
comment on function private.before_user_created(jsonb) is 'oab:m7-signup-modes:v1';
revoke execute on function private.before_user_created(jsonb) from public;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;

create function public.signup_settings_get()
returns table (mode text, signups_per_hour int, signups_per_day int, signups_per_ip_day int)
language sql stable security definer set search_path = '' as $$
  select s.mode, s.signups_per_hour, s.signups_per_day, s.signups_per_ip_day
  from public.signup_settings s where s.id;
$$;
revoke execute on function public.signup_settings_get() from public, anon, authenticated;
grant execute on function public.signup_settings_get() to service_role;

create function public.signup_stats(p_now timestamptz default now())
returns table (last_hour int, last_day int, cap_hour int, cap_day int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_now is null then
    raise exception 'signup_stats: invalid arguments' using errcode = '22023';
  end if;
  return query
    select
      (select count(*)::int from private.signups g where g.at > p_now - interval '1 hour' and g.at <= p_now),
      (select count(*)::int from private.signups g where g.at > p_now - interval '1 day' and g.at <= p_now),
      s.signups_per_hour,
      s.signups_per_day
    from public.signup_settings s where s.id;
end $$;
revoke execute on function public.signup_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.signup_stats(timestamptz) to service_role;
