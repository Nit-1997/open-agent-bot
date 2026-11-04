create table public.chats (
  id              uuid primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default '' check (char_length(title) <= 200),
  model           text check (char_length(model) <= 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (id, user_id)
);
create index chats_user_recent_idx on public.chats (user_id, last_message_at desc, id desc);
create trigger chats_touch before update on public.chats
  for each row execute function private.touch_updated_at();

create table public.chat_messages (
  id         bigint generated always as identity primary key,
  chat_id    uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  run_id     text not null check (char_length(run_id) between 1 and 100),
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (char_length(content) <= 200000),
  status     text not null default 'complete' check (status in ('complete', 'interrupted')),
  created_at timestamptz not null default now(),
  foreign key (chat_id, user_id) references public.chats(id, user_id) on delete cascade
);
create index chat_messages_chat_idx on public.chat_messages (chat_id, user_id, id);
create index chat_messages_user_idx on public.chat_messages (user_id);

create table public.workspace_entities (
  chat_id    uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('cart', 'trip', 'event', 'shortlist')),
  entity_id  text not null check (char_length(entity_id) between 1 and 100),
  value      jsonb not null check (pg_column_size(value) <= 262144),
  version    integer not null check (version > 0),
  updated_at timestamptz not null default now(),
  primary key (chat_id, kind, entity_id),
  foreign key (chat_id, user_id) references public.chats(id, user_id) on delete cascade
);
create index workspace_entities_user_idx on public.workspace_entities (user_id);
create index workspace_entities_chat_user_idx on public.workspace_entities (chat_id, user_id);

create function public.workspace_put(
  p_user uuid, p_chat uuid, p_kind text, p_id text, p_value jsonb, p_expected integer
) returns integer language plpgsql set search_path = '' as $$
declare
  v_version integer;
begin
  if p_expected is null then
    insert into public.workspace_entities as w (chat_id, user_id, kind, entity_id, value, version)
    values (p_chat, p_user, p_kind, p_id, p_value, 1)
    on conflict (chat_id, kind, entity_id)
      do update set value = excluded.value, version = w.version + 1, updated_at = now()
      where w.user_id = p_user
    returning version into v_version;
  elsif p_expected = 0 then
    insert into public.workspace_entities (chat_id, user_id, kind, entity_id, value, version)
    values (p_chat, p_user, p_kind, p_id, p_value, 1)
    on conflict do nothing
    returning version into v_version;
  else
    update public.workspace_entities
       set value = p_value, version = version + 1, updated_at = now()
     where chat_id = p_chat and user_id = p_user and kind = p_kind and entity_id = p_id
       and version = p_expected
    returning version into v_version;
  end if;
  if v_version is null then
    select version into v_version from public.workspace_entities
     where chat_id = p_chat and user_id = p_user and kind = p_kind and entity_id = p_id;
    raise exception using errcode = 'PT409', message = 'version_conflict',
      detail = coalesce(v_version, 0)::text;
  end if;
  return v_version;
end $$;
revoke execute on function public.workspace_put(uuid, uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.workspace_put(uuid, uuid, text, text, jsonb, integer) to service_role;

alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;
alter table public.workspace_entities enable row level security;
revoke all on public.chats, public.chat_messages, public.workspace_entities from anon, authenticated;
