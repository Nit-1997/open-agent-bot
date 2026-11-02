create table public.artifacts (
  id           text primary key check (id ~ '^[A-Za-z0-9_-]{12}$'),
  user_id      uuid not null references auth.users(id) on delete cascade,
  chat_id      uuid,
  title        text not null check (char_length(title) between 1 and 200),
  html_path    text not null,
  pdf_path     text,
  size_bytes   integer not null check (size_bytes between 1 and 5242880),
  created_at   timestamptz not null default now(),
  foreign key (chat_id, user_id) references public.chats(id, user_id) on delete set null (chat_id),
  check (html_path = user_id::text || '/' || id || '.html'),
  check (pdf_path is null or pdf_path = user_id::text || '/' || id || '.pdf')
);
create index artifacts_user_created_idx on public.artifacts (user_id, created_at desc, id desc);
create index artifacts_chat_idx on public.artifacts (chat_id, user_id);

alter table public.artifacts enable row level security;
revoke all on public.artifacts from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artifacts', 'artifacts', false, 10485760, array['text/html', 'application/pdf']);
