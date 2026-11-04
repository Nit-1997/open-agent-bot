create table public.request_usage (
  user_id  uuid not null references auth.users(id) on delete cascade,
  month    date not null check (extract(day from month) = 1),
  count    integer not null default 0 check (count >= 0),
  last_at  timestamptz,
  primary key (user_id, month)
);
create index request_usage_month_last_idx on public.request_usage (month, last_at desc nulls last, user_id);

create table public.request_log (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null
);
create index request_log_user_at_idx on public.request_log (user_id, at);
create index request_log_at_idx on public.request_log (at);

create table public.human_checks (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  checked_at timestamptz not null default now()
);

create table private.signup_pepper (
  id     boolean primary key default true check (id),
  pepper bytea not null check (octet_length(pepper) = 32)
);
insert into private.signup_pepper (pepper) values (extensions.gen_random_bytes(32));

create table private.usage_tombstones (
  email_hash       bytea not null check (octet_length(email_hash) = 32),
  month            date not null check (extract(day from month) = 1),
  count            integer not null check (count >= 0),
  human_checked_at timestamptz,
  deleted_at       timestamptz not null default now(),
  primary key (email_hash, month)
);
create index usage_tombstones_deleted_idx on private.usage_tombstones (deleted_at);

alter table public.request_usage enable row level security;
alter table public.request_log enable row level security;
alter table public.human_checks enable row level security;
revoke all on public.request_usage, public.request_log, public.human_checks from anon, authenticated;
grant select, insert, update, delete on public.request_usage, public.request_log, public.human_checks to service_role;
grant select on public.profiles to service_role;
revoke all on private.signup_pepper, private.usage_tombstones from public, anon, authenticated, service_role, authenticator;

create function public.request_admit(p_user uuid, p_month_cap int, p_hour_cap int, p_now timestamptz default now())
returns table (ok boolean, reason text, month_used int, hour_used int, retry_at timestamptz, log_id bigint)
language plpgsql set search_path = '' as $$
declare
  v_month  date;
  v_used   int;
  v_hour   int;
  v_oldest timestamptz;
  v_log    bigint;
begin
  if p_user is null or p_now is null or p_month_cap is null or p_hour_cap is null or p_month_cap < 1 or p_hour_cap < 1 then
    raise exception 'request_admit: invalid arguments' using errcode = '22023';
  end if;
  v_month := date_trunc('month', p_now at time zone 'utc')::date;
  perform pg_advisory_xact_lock(hashtextextended('request_admit:' || p_user::text, 0));
  insert into public.request_usage (user_id, month) values (p_user, v_month) on conflict do nothing;
  select u.count into v_used from public.request_usage u where u.user_id = p_user and u.month = v_month;
  delete from public.request_log l where l.user_id = p_user and l.at <= p_now - interval '1 hour';
  select count(*)::int, min(l.at) into v_hour, v_oldest
    from public.request_log l where l.user_id = p_user and l.at > p_now - interval '1 hour';
  if v_used >= p_month_cap then
    return query select false, 'month', v_used, v_hour, ((v_month + interval '1 month')::timestamp at time zone 'utc'), null::bigint;
    return;
  end if;
  if v_hour >= p_hour_cap then
    return query select false, 'hour', v_used, v_hour, v_oldest + interval '1 hour', null::bigint;
    return;
  end if;
  update public.request_usage u set count = u.count + 1, last_at = p_now
    where u.user_id = p_user and u.month = v_month returning u.count into v_used;
  insert into public.request_log (user_id, at) values (p_user, p_now) returning id into v_log;
  return query select true, 'ok', v_used, v_hour + 1, null::timestamptz, v_log;
end $$;
revoke execute on function public.request_admit(uuid, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.request_admit(uuid, int, int, timestamptz) to service_role;

create function public.request_refund(p_user uuid, p_log_id bigint)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_at timestamptz;
begin
  if p_user is null or p_log_id is null then
    raise exception 'request_refund: invalid arguments' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('request_admit:' || p_user::text, 0));
  delete from public.request_log l where l.id = p_log_id and l.user_id = p_user returning l.at into v_at;
  if v_at is null then
    return false;
  end if;
  update public.request_usage u set count = greatest(u.count - 1, 0)
    where u.user_id = p_user and u.month = date_trunc('month', v_at at time zone 'utc')::date;
  return true;
end $$;
revoke execute on function public.request_refund(uuid, bigint) from public, anon, authenticated;
grant execute on function public.request_refund(uuid, bigint) to service_role;

create function public.request_usage_get(p_user uuid, p_now timestamptz default now())
returns table (month_used int, hour_used int, hour_retry_at timestamptz)
language sql stable set search_path = '' as $$
  select
    coalesce((select u.count from public.request_usage u
               where u.user_id = p_user and u.month = date_trunc('month', p_now at time zone 'utc')::date), 0),
    (select count(*)::int from public.request_log l where l.user_id = p_user and l.at > p_now - interval '1 hour'),
    (select min(l.at) + interval '1 hour' from public.request_log l where l.user_id = p_user and l.at > p_now - interval '1 hour');
$$;
revoke execute on function public.request_usage_get(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.request_usage_get(uuid, timestamptz) to service_role;

create function public.request_usage_summary(p_now timestamptz default now())
returns table (month_total bigint, active_users int)
language sql stable set search_path = '' as $$
  select coalesce(sum(u.count), 0)::bigint, (count(*) filter (where u.count > 0))::int
  from public.request_usage u
  where u.month = date_trunc('month', p_now at time zone 'utc')::date;
$$;
revoke execute on function public.request_usage_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.request_usage_summary(timestamptz) to service_role;

create function public.request_usage_page(p_query text, p_at_least int, p_limit int, p_offset int, p_now timestamptz default now())
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_month   date;
  v_pattern text;
  v_limit   int := least(greatest(coalesce(p_limit, 1), 1), 50);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_result  jsonb;
begin
  if p_now is null or (p_at_least is not null and p_at_least < 1) or char_length(coalesce(p_query, '')) > 100 then
    raise exception 'request_usage_page: invalid arguments' using errcode = '22023';
  end if;
  v_month := date_trunc('month', p_now at time zone 'utc')::date;
  if coalesce(p_query, '') <> '' then
    v_pattern := '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  with matched as (
    select u.user_id, p.email, u.count, u.last_at
    from public.request_usage u
    join public.profiles p on p.user_id = u.user_id
    where u.month = v_month and u.count > 0
      and (p_at_least is null or u.count >= p_at_least)
      and (v_pattern is null or p.email ilike v_pattern escape '\')
  ),
  paged as (
    select m.* from matched m
    order by m.last_at desc nulls last, m.user_id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from matched),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'email', x.email, 'month_used', x.count, 'last_at', x.last_at)
                       order by x.last_at desc nulls last, x.user_id)
      from paged x
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke execute on function public.request_usage_page(text, int, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.request_usage_page(text, int, int, int, timestamptz) to service_role;

create function public.request_log_prune(p_now timestamptz default now())
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_now is null then
    raise exception 'request_log_prune: invalid arguments' using errcode = '22023';
  end if;
  delete from public.request_log l where l.at <= p_now - interval '1 hour';
  delete from private.usage_tombstones t where t.deleted_at <= p_now - interval '2 months';
end $$;
revoke execute on function public.request_log_prune(timestamptz) from public, anon, authenticated;
grant execute on function public.request_log_prune(timestamptz) to service_role;

create function public.human_check_get(p_user uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.human_checks h where h.user_id = p_user);
$$;
revoke execute on function public.human_check_get(uuid) from public, anon, authenticated;
grant execute on function public.human_check_get(uuid) to service_role;

create function public.human_check_set(p_user uuid)
returns void language sql set search_path = '' as $$
  insert into public.human_checks (user_id) values (p_user) on conflict (user_id) do nothing;
$$;
revoke execute on function public.human_check_set(uuid) from public, anon, authenticated;
grant execute on function public.human_check_set(uuid) to service_role;

create function public.usage_tombstone(p_user uuid, p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_month   date;
  v_email   text;
  v_hash    bytea;
  v_count   int;
  v_checked timestamptz;
begin
  if p_user is null or p_now is null then
    raise exception 'usage_tombstone: invalid arguments' using errcode = '22023';
  end if;
  v_month := date_trunc('month', p_now at time zone 'utc')::date;
  perform pg_advisory_xact_lock(hashtextextended('request_admit:' || p_user::text, 0));
  select p.email into v_email from public.profiles p where p.user_id = p_user;
  if v_email is null then
    return false;
  end if;
  select sha256(convert_to(lower(v_email), 'UTF8') || s.pepper) into v_hash from private.signup_pepper s;
  select u.count into v_count from public.request_usage u where u.user_id = p_user and u.month = v_month;
  select h.checked_at into v_checked from public.human_checks h where h.user_id = p_user;
  insert into private.usage_tombstones as t (email_hash, month, count, human_checked_at, deleted_at)
  values (v_hash, v_month, coalesce(v_count, 0), v_checked, p_now)
  on conflict (email_hash, month) do update
    set count = greatest(t.count, excluded.count),
        human_checked_at = coalesce(excluded.human_checked_at, t.human_checked_at),
        deleted_at = excluded.deleted_at;
  return true;
end $$;
revoke execute on function public.usage_tombstone(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.usage_tombstone(uuid, timestamptz) to service_role;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_month   date := date_trunc('month', now() at time zone 'utc')::date;
  v_hash    bytea;
  v_count   int;
  v_checked timestamptz;
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email))
  on conflict (user_id) do nothing;
  select sha256(convert_to(lower(new.email), 'UTF8') || s.pepper) into v_hash from private.signup_pepper s;
  select t.count into v_count from private.usage_tombstones t where t.email_hash = v_hash and t.month = v_month;
  if v_count > 0 then
    insert into public.request_usage (user_id, month, count) values (new.id, v_month, v_count)
    on conflict (user_id, month) do nothing;
  end if;
  select max(t.human_checked_at) into v_checked from private.usage_tombstones t
    where t.email_hash = v_hash and t.deleted_at > now() - interval '2 months';
  if v_checked is not null then
    insert into public.human_checks (user_id, checked_at) values (new.id, v_checked)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
revoke execute on function private.handle_new_user() from public;
