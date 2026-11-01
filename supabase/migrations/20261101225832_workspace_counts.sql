create function public.workspace_counts(p_user uuid) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb)
  from (
    select w.kind, count(*) as n
    from public.workspace_entities w
    where w.user_id = p_user
    group by w.kind
  ) k
$$;

revoke execute on function public.workspace_counts(uuid) from public, anon, authenticated;
grant execute on function public.workspace_counts(uuid) to service_role;
