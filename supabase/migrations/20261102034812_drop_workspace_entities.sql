drop function if exists public.workspace_counts(uuid);
drop function if exists public.workspace_put(uuid, uuid, text, text, jsonb, integer);
drop table if exists public.workspace_entities;
