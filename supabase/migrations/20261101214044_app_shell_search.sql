create extension if not exists pg_trgm with schema extensions;

create index chats_title_trgm_idx
  on public.chats using gin (title extensions.gin_trgm_ops);
create index chat_messages_content_trgm_idx
  on public.chat_messages using gin (content extensions.gin_trgm_ops);
create index artifacts_title_trgm_idx
  on public.artifacts using gin (title extensions.gin_trgm_ops);
create index workspace_entities_user_recent_idx
  on public.workspace_entities (user_id, updated_at desc, chat_id, kind, entity_id);
drop index public.workspace_entities_user_idx;

create function public.search_user_content(
  p_user uuid, p_query text, p_scope text, p_limit integer, p_offset integer
) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_pattern text;
  v_needle text;
  v_result jsonb;
begin
  if p_user is null or p_query is null or p_scope is null or p_limit is null or p_offset is null
     or char_length(p_query) not between 2 and 100
     or p_scope not in ('all', 'chats', 'reports')
     or p_limit not between 1 and 50
     or p_offset not between 0 and 10000 then
    raise exception using errcode = '22023', message = 'invalid_search';
  end if;
  v_pattern := '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_needle := lower(p_query);

  with message_hits as (
    select distinct on (m.chat_id) m.chat_id, m.content
    from public.chat_messages m
    where m.user_id = p_user and m.content ilike v_pattern
    order by m.chat_id, m.id desc
  ),
  hits as (
    select 'chat'::text as kind, c.id::text as ref_id, c.title, c.last_message_at as occurred_at, c.id as chat_id,
           case when c.title ilike v_pattern then 'title' else 'message' end as match, mh.content
    from public.chats c
    left join message_hits mh on mh.chat_id = c.id
    where c.user_id = p_user and (c.title ilike v_pattern or mh.chat_id is not null)
    union all
    select 'report', a.id, a.title, a.created_at, a.chat_id, 'title', null
    from public.artifacts a
    where a.user_id = p_user and a.title ilike v_pattern
  ),
  scoped as (
    select h.* from hits h
    where p_scope = 'all'
       or (p_scope = 'chats' and h.kind = 'chat')
       or (p_scope = 'reports' and h.kind = 'report')
  ),
  page as (
    select s.*, greatest(1, strpos(lower(s.content), v_needle) - 60) as start_at
    from scoped s
    order by s.occurred_at desc, s.ref_id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'chats', (select count(*) from hits where kind = 'chat'),
    'reports', (select count(*) from hits where kind = 'report'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', p.kind, 'refId', p.ref_id, 'title', p.title, 'at', p.occurred_at, 'chatId', p.chat_id,
        'match', p.match,
        'snippet', substr(p.content, p.start_at, 180),
        'snippetStart', case when p.content is null then null else p.start_at end,
        'contentLength', char_length(p.content)
      ) order by p.occurred_at desc, p.ref_id desc)
      from page p
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

revoke execute on function public.search_user_content(uuid, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.search_user_content(uuid, text, text, integer, integer) to service_role;
