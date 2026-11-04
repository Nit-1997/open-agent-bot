alter table public.chat_messages
  add column parts jsonb check (parts is null or (jsonb_typeof(parts) = 'array' and pg_column_size(parts) <= 1048576));

with placed as (
  select a.id as artifact_id, a.title, a.created_at,
    (select m.id from public.chat_messages m
      where m.chat_id = a.chat_id and m.user_id = a.user_id and m.role = 'assistant' and m.created_at >= a.created_at
        and not exists (
          select 1 from public.chat_messages u
           where u.chat_id = a.chat_id and u.user_id = a.user_id and u.role = 'user'
             and u.created_at > a.created_at and u.id < m.id)
      order by m.id limit 1) as message_id
  from public.artifacts a
  where a.chat_id is not null
), grouped as (
  select message_id,
    jsonb_agg(jsonb_build_object(
      'type', 'tool', 'id', 'saved-' || artifact_id, 'name', 'create_artifact',
      'args', jsonb_build_object('title', title)::text,
      'result', 'artifact ' || artifact_id || ' created: ' || title) order by created_at) as tools
  from placed
  where message_id is not null
  group by message_id
)
update public.chat_messages m
   set parts = g.tools || case when btrim(m.content) <> '' then jsonb_build_array(jsonb_build_object('type', 'text', 'text', btrim(m.content))) else '[]'::jsonb end
  from grouped g
 where m.id = g.message_id and m.parts is null;
