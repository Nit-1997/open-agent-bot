# Invite-only accounts on Supabase, with every user's data in Supabase

Status: draft for review · 2026-10-31 · branch `feat/supabase-auth`

## Why

Open Agent is single-user today. There is no login, so anyone who reaches port 3000 can read the profile and change keys, and the README tells people to keep it on localhost. Everything a user owns sits on Docker volumes: `profile.json`, `auth.json` (provider OAuth tokens), `local-keys.json` (plaintext API keys), `providers.json`, `workspace.sqlite`, and the artifact HTML/PDF files.

We want to run it for a small invited group: the web app on Vercel and the agent (with SearXNG and Chromium) on an EC2 instance behind Caddy. That needs three things. Only invited people get in. Each person's data is isolated from everyone else's. The EC2 box keeps no user data on disk, so losing or rebuilding the instance loses nothing and a disk snapshot exposes nothing.

The 2026-10-30 onboarding design put the profile behind a `ProfileStore` interface "so a later login only has to attach it to a user". This is that later project, extended to every other store.

## Goals

- Invite-only access. A visitor asks for access, the admin approves, the invitee gets an email link, clicks it and is signed in. After that they sign in with Google, or with an emailed link if their address has no Google account.
- Supabase refuses sign-ups from anyone who wasn't invited. A second check runs inside the database, so a dashboard mistake (re-enabling sign-ups) still doesn't let strangers in.
- Every request to the agent carries the user's Supabase access token. The agent checks it against the project's public keys (ES256 via JWKS) and takes the user id only from the token.
- Every piece of per-user state lives in Supabase (Postgres plus Storage), scoped by `user_id`, with RLS on every table. The agent container runs read-only with a tmpfs and no volumes.
- Provider keys and OAuth tokens are encrypted by the agent (AES-256-GCM, envelope encryption) before they reach the database. The browser can write a key but never read one back; it only sees a hint like `sk-ant-…a91f`.
- Supabase auth settings and SQL are code: one idempotent configuration script and committed migrations.
- Local development mirrors EC2: everything runs in docker compose behind Caddy with TLS.

## Non-goals

- Teams, sharing chats or artifacts between users, or roles other than admin and user.
- Billing, usage quotas per user (beyond abuse rate limits), or usage dashboards.
- MFA. Supabase supports TOTP and it can be switched on later without schema changes.
- Self-service account deletion. The admin deletes accounts (see "Delete a user").
- Moving SearXNG or Chromium off EC2.
- A memory system. Mem0-style memory is still out of scope.

## Anti-goals (failures even if it works)

- A key, refresh token, or access token appears in a log line, an error message, a URL, or a browser-readable response.
- The agent trusts a user id from anywhere other than a verified token (a body field, `threadId`, a header the web sets).
- One user can open, continue, or read another user's chat, cart, artifact or provider login by guessing or reusing an id.
- The request-access form tells a visitor whether an email is already a user or already asked.
- Some code path silently falls back to "no auth" when Supabase is unreachable. Every auth failure fails closed, with a clear message.
- Data stays on the EC2 disk "temporarily" (a cache file, a SQLite file, a PDF cache).

## Decisions at a glance

| Topic | Decision |
| --- | --- |
| Identity | Supabase Auth on project `dwiuzfvmevdzzabqeaog`. Google OAuth plus email links (invite, magic link). No passwords. |
| Sign-up | `disable_signup = true`. Plus a `before-user-created` Postgres hook that only allows emails in `public.invited_emails`. |
| Admin | `app_metadata.role = "admin"` (users can't edit `app_metadata`). The first admin is set up by a one-off bootstrap script. |
| Session in browser | `@supabase/ssr`, PKCE, HttpOnly + Secure + SameSite=Lax cookies. No Supabase client runs in the browser. |
| Web → agent | Server-to-server only. `Authorization: Bearer <user access token>` plus `x-agent-secret: <service secret>`. The browser never calls the agent. |
| Token verification | `jose` with remote JWKS from `https://dwiuzfvmevdzzabqeaog.supabase.co/auth/v1/.well-known/jwks.json`. Only `ES256` is accepted; `iss`, `aud=authenticated`, `exp`, `role=authenticated` and `is_anonymous=false` are checked. |
| Shared secret | The generated file on a shared volume goes away. It is replaced by `AGENT_SERVICE_SECRET`, a static secret in `.env-agent`, `.env-nextjs` and Vercel. It is required on every agent route except `/health`, as defense in depth (the agent is now on the public internet). It never identifies a user. |
| Agent DB access | `supabase-js` with the secret key (`sb_secret_…`), wrapped in a user-scoped repository layer. Raw clients are never exported from `agent/src/db/`. |
| Browser reads | Go through Next.js server code using the user's token, so RLS applies. Writes that need validation go through the agent. |
| Key storage | `provider_credentials`, with RLS on and no policies. A random data key per row encrypts the value (AES-256-GCM). The data key is wrapped by a master key from `CREDENTIAL_KEYS` (AES-256-GCM). The AAD binds user, provider, kind and key version. A `KeyWrapper` interface makes AWS KMS a drop-in later. |
| Artifacts | Private Storage bucket `artifacts`, path `{user_id}/{artifact_id}.html|.pdf`. Metadata lives in `public.artifacts`. They are served only through agent → web, which adds the sandbox CSP. |
| Chats | `public.chats` and `public.chat_messages`. The thread id is a client-made UUID, but ownership is claimed in the database on the first run. |
| Email | Supabase custom SMTP via Resend (`smtp.resend.com:465`, user `resend`). Sender `onboarding@resend.dev` for now. |
| Hosting | Web on Vercel. Agent, SearXNG and Caddy on EC2. Locally, the same compose file adds the web service and a local Caddyfile. |

## Project state today (read 2026-10-31 via Management API and MCP)

- Postgres 17. Extensions: `pgcrypto`, `uuid-ossp`, `supabase_vault`, `pg_stat_statements`. The `public` schema is empty, there are no migrations, no Storage buckets, and 0 users.
- Signing keys: ES256 key `in_use` and the JWKS publishes one EC/ES256 key. The legacy HS256 secret is `previously_used`, not revoked. Legacy `anon` and `service_role` API keys are still enabled, next to a `publishable` and a `secret` key.
- Auth config: `disable_signup=false`, Google off, no custom SMTP, `site_url=http://localhost:3000`, empty `uri_allow_list`, `jwt_exp=3600`, `refresh_token_rotation_enabled=true` (reuse interval 10 s), `mailer_otp_exp=3600`, `rate_limit_email_sent=2`, every hook off, `security_manual_linking_enabled=false`, default templates.

All of this changes through the script and migrations below, never by hand in the dashboard.

## Architecture

```
                         Browser (Chrome)
                             │  HTTPS, cookies only for the web origin
                             ▼
   ┌──────────────────────────────────────────────────────────┐
   │ web: Next.js 16 (Vercel; locally web container behind     │
   │      Caddy at https://app.localhost)                     │
   │  proxy.ts ── @supabase/ssr: refresh session (getClaims)  │
   │  /login /request-access /auth/callback /auth/confirm     │
   │  /admin (admin claim) · /api/* thin proxies · CopilotKit │
   │  server-side Supabase client (publishable key + user JWT)│──┐ RLS reads
   └───────────────┬──────────────────────────────────────────┘  │ (chats list,
                   │ HTTPS  Authorization: Bearer <access token>  │  admin lists)
                   │        x-agent-secret: <AGENT_SERVICE_SECRET>│
                   ▼                                              │
   ┌─────────────── EC2 (docker compose) ────────────────┐        │
   │ caddy :443 ── TLS (Let's Encrypt) ── agent:8000      │        │
   │ agent (read-only fs, tmpfs /tmp, no volumes)         │        │
   │  auth/: service secret → JWT (JWKS, ES256) → status  │        │
   │  db/:   user-scoped repos (secret key)               │───────►├──► Supabase
   │  crypto/: envelope AES-256-GCM (CREDENTIAL_KEYS)     │  HTTPS │    Auth (GoTrue, JWKS,
   │  per-user ProviderHub + pi ModelRuntime (in memory)  │        │     SMTP → Resend)
   │  sessions keyed by user+chat, Chromium pool          │        │    Postgres (RLS)
   │ search (SearXNG, internal only)                      │        │    Storage (artifacts)
   └──────────────────────────────────────────────────────┘        │
                                                                   ▼
                                               Google OAuth ◄── Supabase redirects
```

Trust boundaries:

1. **Browser ↔ web.** Cookies are scoped to the web origin and HttpOnly. The browser holds no tokens it can read from JS. Server actions and POST routes check the Origin header.
2. **Web ↔ agent.** Server to server over TLS. The service secret proves the caller is our web app. The bearer token proves the user. Both are required.
3. **Agent ↔ Supabase.** The secret key bypasses RLS. That is why the agent only touches data through `forUser(userId)` repositories that put `user_id` into every query and every insert.
4. **Browser data ↔ Supabase.** Only through the Next.js server with the user's JWT, so RLS is the backstop if web code has a bug.

## Inventory: per-user state today and its new home

| Today | File / place | New home | Browser access |
| --- | --- | --- | --- |
| Profile (home, household, food, travel, shopping, `defaultModel`, notes, skipped, `onboardedAt`) | `/data/agent/profile.json` (`agent/src/profile/store.ts`) | `public.profiles.data` (jsonb), one row per user | Read own row via RLS. Writes go through the agent (`PUT /profile`, typebox-validated). |
| Cloud provider API keys and OAuth logins (ChatGPT) | `/data/agent/auth.json` (pi `ModelRuntime` file store) | `public.provider_credentials` (encrypted), behind a `CredentialStore` implementation | None. The hint comes back through the agent's `/providers`. |
| Local/custom provider API keys, Brave Search key | `/data/agent/local-keys.json` (plaintext) | `public.provider_credentials` (`provider` = `ollama`, `custom`, …, or `secret:brave-search`) | None |
| Provider settings (custom base URLs and models, enabled models, hidden) | `/data/agent/providers.json` | `public.provider_settings.data` (jsonb) | Read own via RLS (not needed by the UI today; reads go through the agent's `/providers`) |
| OpenAI device id | `/data/agent/device-id` | `public.provider_settings.device_id` (uuid, per user) | Read own |
| Workspace (carts, trips, events, shortlists) | `/data/agent/workspace.sqlite` | `public.workspace_entities` | Read own |
| Chats | Not persisted. Threads exist in agent memory, and history is re-sent by the client and rebuilt in `restoreHistory` | `public.chats` and `public.chat_messages` | Read own (recent chats list) |
| Artifacts (HTML, metadata, PDF cache) | `/data/artifacts/{id}.html|.json|.pdf` | Storage `artifacts/{user_id}/{id}.html|.pdf` plus `public.artifacts` | Through agent → web only (sandbox CSP) |
| In-flight provider sign-in flows | `LoginFlows` map (memory) | Still memory, but each flow is bound to `userId` | — |
| Live pi sessions, browser contexts, evidence, frames | `SessionStore` (memory) | Still memory, keyed by `userId:chatId` | — |
| pi session scratch dir | `mkdtemp` in `/tmp` | tmpfs `/tmp` (deleted on dispose, as now) | — |
| Web↔agent secret | `/data/shared/agent-secret` (generated) | `AGENT_SERVICE_SECRET` env (not user data) | — |
| SearXNG secret | `searxng-data` volume | Unchanged (not user data) | — |
| Theme | `localStorage.theme` | Unchanged (per device, not sensitive) | — |

Volumes removed from compose: `agent-data`, `artifacts-data`, `shared`. Since there are no users yet, nothing is migrated (owner's rule); the old files are deleted.

## Data model

All SQL lives in `supabase/migrations/`, named `YYYYMMDDHHMMSS_name.sql`, and is applied in order with the Supabase MCP `apply_migration` (or `supabase db push`). Every migration is idempotent where Postgres allows it (`if not exists`, `create or replace`, `drop policy if exists`). The public schema is empty today, and `list_migrations` returns none.

Conventions:

- Every per-user table has `user_id uuid not null references auth.users(id) on delete cascade`.
- Child tables reference their parent with a composite FK `(parent_id, user_id) → parent(id, user_id)`. The database itself then guarantees that a row's `user_id` matches its parent's owner.
- RLS is enabled on every table. Policies name a role (`to authenticated`) and wrap auth calls in `(select …)` so they are evaluated once per statement.
- Grants are explicit. `anon` gets nothing on any table. `authenticated` gets `select` only where a read policy exists. `service_role` (what the secret key maps to) keeps its default grants.
- Helper functions live in schema `private`, which PostgREST does not expose.

### Migration 1: `20261031120000_private_schema.sql`

```sql
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function private.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'admin', false)
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;
```

### Migration 2: `20261031120100_profiles.sql`

```sql
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null check (email = lower(email) and char_length(email) <= 254),
  data       jsonb not null default '{}'::jsonb
             check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  status     text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_created_at_idx on public.profiles (created_at desc, user_id desc);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create or replace function private.is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and status = 'active'
  )
$$;
revoke all on function private.is_active() from public, anon;
grant execute on function private.is_active() to authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email))
  on conflict (user_id) do nothing;
  return new;
end $$;

create or replace function private.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where user_id = new.id;
  return new;
end $$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.handle_user_email_change() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active()));
create policy profiles_select_admin on public.profiles for select to authenticated
  using ((select private.is_admin()));
```

There are no insert, update or delete policies. Profile writes go through the agent, which validates `data` with the shared typebox `ProfileSchema`, and status changes go through admin endpoints. `email` is a copy kept in sync by the trigger, so the admin user list is one RLS query.

### Migration 3: `20261031120200_access.sql`

```sql
create table if not exists public.access_requests (
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
create unique index if not exists access_requests_one_pending
  on public.access_requests (email) where status = 'pending';
create index if not exists access_requests_status_created_idx
  on public.access_requests (status, created_at desc, id desc);
create index if not exists access_requests_created_idx
  on public.access_requests (created_at desc, id desc);
create index if not exists access_requests_ip_created_idx
  on public.access_requests (ip_hash, created_at desc);

alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon, authenticated;
grant select on public.access_requests to authenticated;
create policy access_requests_select_admin on public.access_requests for select to authenticated
  using ((select private.is_admin()));

create table if not exists public.invited_emails (
  email      text primary key check (email = lower(email) and char_length(email) <= 254),
  request_id uuid references public.access_requests(id) on delete set null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.invited_emails enable row level security;
revoke all on public.invited_emails from anon, authenticated;
grant select on public.invited_emails to supabase_auth_admin;
create policy invited_emails_auth_admin_read on public.invited_emails for select
  to supabase_auth_admin using (true);

create or replace function private.before_user_created(event jsonb)
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
revoke all on function private.before_user_created(jsonb) from public, anon, authenticated;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;
```

- `ip_hash` is `HMAC-SHA256(ACCESS_REQUEST_PEPPER, client_ip)`. Raw IPs are never stored.
- The one-pending-per-email unique index makes a duplicate submission a no-op (`on conflict do nothing`), and the visitor sees the same response either way.
- The hook allows a user only if the email is in `invited_emails`. The agent inserts that row before calling the invite API, and the bootstrap script does the same for the first admin. Deleting a user also deletes their `invited_emails` row.

### Migration 4: `20261031120300_chats_workspace.sql`

```sql
create table if not exists public.chats (
  id              uuid primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default '' check (char_length(title) <= 200),
  model           text check (char_length(model) <= 200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists chats_user_recent_idx on public.chats (user_id, last_message_at desc, id desc);
create trigger chats_touch before update on public.chats
  for each row execute function private.touch_updated_at();

create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  chat_id    uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  run_id     text not null check (char_length(run_id) <= 100),
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (char_length(content) <= 200000),
  created_at timestamptz not null default now(),
  foreign key (chat_id, user_id) references public.chats(id, user_id) on delete cascade
);
create index if not exists chat_messages_chat_idx on public.chat_messages (chat_id, id);
create index if not exists chat_messages_user_idx on public.chat_messages (user_id);

create table if not exists public.workspace_entities (
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
create index if not exists workspace_entities_user_idx on public.workspace_entities (user_id);

create or replace function public.workspace_put(
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
    raise exception using errcode = 'P0409', message = 'version_conflict',
      detail = coalesce(v_version, 0)::text;
  end if;
  return v_version;
end $$;
revoke all on function public.workspace_put(uuid, uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.workspace_put(uuid, uuid, text, text, jsonb, integer) to service_role;

alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;
alter table public.workspace_entities enable row level security;
revoke all on public.chats, public.chat_messages, public.workspace_entities from anon, authenticated;
grant select on public.chats, public.chat_messages, public.workspace_entities to authenticated;

create policy chats_select_own on public.chats for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active()));
create policy chat_messages_select_own on public.chat_messages for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active()));
create policy workspace_select_own on public.workspace_entities for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active()));
```

- `kind` mirrors `ENTITY_KINDS` in `shared/workspace.ts`. A unit test asserts the two lists match.
- `workspace_put` runs the optimistic version check in one statement, so two concurrent turns can't both win. The agent maps SQLSTATE `P0409` to the existing `VersionConflict` (expected vs `detail`).
- The `where w.user_id = p_user` on the upsert path, plus the composite FK, means a different user's row can never be overwritten, even when the ids collide.

### Migration 5: `20261031120400_artifacts.sql`

```sql
create table if not exists public.artifacts (
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
create index if not exists artifacts_user_created_idx on public.artifacts (user_id, created_at desc, id desc);

alter table public.artifacts enable row level security;
revoke all on public.artifacts from anon, authenticated;
grant select on public.artifacts to authenticated;
create policy artifacts_select_own on public.artifacts for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artifacts', 'artifacts', false, 10485760, array['text/html', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
```

There are no `storage.objects` policies for the `artifacts` bucket. Storage denies by default, so only the agent's secret key reads and writes it. This is deliberate. Artifact HTML must always be served with `Content-Security-Policy: sandbox …` and `nosniff`, which only our own route adds. A browser-readable signed URL or RLS read would bypass that. Path ownership is enforced three times: the agent always builds the path from the verified user id, the table check constraints, and the metadata lookup by `(id, user_id)`.

On user deletion, `public.artifacts` rows cascade but Storage objects don't. The delete-user flow removes `artifacts/{user_id}/` first (see flows).

### Migration 6: `20261031120500_providers.sql`

```sql
create table if not exists public.provider_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{"custom":{},"enabled":{},"hidden":[]}'::jsonb
             check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 131072),
  device_id  uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
create trigger provider_settings_touch before update on public.provider_settings
  for each row execute function private.touch_updated_at();

create table if not exists public.provider_credentials (
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null check (provider ~ '^[a-z0-9][a-z0-9:_-]{0,63}$'),
  kind        text not null check (kind in ('api_key', 'oauth')),
  ciphertext  bytea not null check (octet_length(ciphertext) between 17 and 65536),
  nonce       bytea not null check (octet_length(nonce) = 12),
  dek_wrapped bytea not null check (octet_length(dek_wrapped) = 48),
  dek_nonce   bytea not null check (octet_length(dek_nonce) = 12),
  key_version integer not null check (key_version > 0),
  hint        text not null check (char_length(hint) <= 40),
  version     integer not null default 1 check (version > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, provider)
);
create index if not exists provider_credentials_key_version_idx on public.provider_credentials (key_version);
create trigger provider_credentials_touch before update on public.provider_credentials
  for each row execute function private.touch_updated_at();

alter table public.provider_settings enable row level security;
alter table public.provider_credentials enable row level security;
revoke all on public.provider_settings, public.provider_credentials from anon, authenticated;
grant select on public.provider_settings to authenticated;
create policy provider_settings_select_own on public.provider_settings for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active()));
```

`provider_credentials` has RLS on and no policies, and grants are revoked from `anon` and `authenticated`. Only `service_role` (the agent's secret key) can touch it. `dek_wrapped` is 32 bytes of data key plus a 16-byte GCM tag. `ciphertext` is the encrypted value with its 16-byte tag appended. `version` gives `modify` optimistic concurrency.

### Post-migration checks

After applying, run MCP `get_advisors` (security and performance) and fix every finding before moving on. Expected and accepted: "RLS enabled, no policy" on `provider_credentials` and `invited_emails` (intentional). Record the accepted ones in the migration's header comment.

## Auth flows

The URLs below use the local origin `https://app.localhost`. In production the origin is the Vercel domain, called `APP_ORIGIN` everywhere.

### 1. Request access (visitor)

1. `/request-access` (public) shows name, email, note (optional, up to 1000 characters), and a hidden honeypot field `company_website`. The server action also gets a signed render timestamp (HMAC with `AGENT_SERVICE_SECRET` as key is fine; builder's call).
2. The server action validates lengths and email shape. It drops the request silently (same success response) if the honeypot is filled or the form was submitted less than 3 seconds after render.
3. Web → agent `POST /access-requests` with the service secret, `{ name, email, note }`, and `x-client-ip` taken from Vercel's `x-forwarded-for` first hop (locally, Caddy's `X-Forwarded-For`). The agent trusts `x-client-ip` only because the service secret authenticated the caller.
4. The agent lowercases and trims the email and computes `ip_hash`. It enforces, from the DB:
   - at most 3 requests per `ip_hash` per hour, and 10 per day;
   - at most 200 requests in total per day (a flood circuit-breaker);
   - then `insert … on conflict do nothing`. A pending duplicate inserts nothing.
5. The response is always `202 { ok: true }` with the same body and roughly the same latency (the agent pads to a 300 ms floor), whether the row was inserted, deduplicated, rate-limited, or the email already belongs to a user. The page shows: "Thanks. If you're approved, you'll get an email from Open Agent." Rate limiting is logged at `warn` with the ip_hash prefix, never the email.
6. There is no read-back. The visitor can't see or edit their request.

### 2. Approve and invite (admin)

1. The admin opens `/admin`. The page checks the claim `app_metadata.role === "admin"` from `getClaims()` and returns 404 to everyone else. The Requests tab reads `access_requests` with the user's JWT (RLS policy `access_requests_select_admin`).
2. **Approve** (a server action) → web → agent `POST /admin/access-requests/:id/approve`. The agent does `requireAdmin`: the claim check plus a live `auth.admin.getUserById(sub)` confirming `app_metadata.role === "admin"` and not banned. Then:
   1. Load the request. If it isn't `pending`, return `409` "Already decided".
   2. `insert into invited_emails (email, request_id, invited_by) … on conflict do nothing`.
   3. Call `auth.admin.inviteUserByEmail(email, { redirectTo: APP_ORIGIN + "/auth/confirm", data: { name } })`.
   4. On success, set `status='approved'`, `invite_status='sent'`, `user_id`, `decided_by`, `decided_at`.
   5. On failure, set `status='approved'`, `invite_status='failed'`, and a scrubbed `invite_error` (provider message only, cut to 500 characters, never the full response). Return `502` with "Invite email failed: <reason>. Use Resend invite."
   6. **Resend invite** (`POST …/resend`) works in two ways. If no auth user has that email yet, it repeats step 3. If one does (an earlier invite created the user but the email failed or expired), it calls `auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: APP_ORIGIN + "/auth/confirm" } })`, which sends the magic-link template. Either way, it updates `invite_status` and `invite_error`.
3. **Reject**: set `status='rejected'`, `decided_by`, `decided_at`. No email is sent. A later request from the same email is allowed (new row).
4. Supabase sends the invite email through Resend using the customized template (below).

The Resend sandbox sender (`onboarding@resend.dev`) only delivers to the Resend account owner (`ntnbhat9@gmail.com`). Until a domain is verified, approving anyone else will most likely take the `invite_status='failed'` path. That is expected and visible in the UI. The end-to-end test uses `generateLink` instead (see Testing).

### 3. First sign-in from the invite link

1. Invite template link: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`. `RedirectTo` is `APP_ORIGIN/auth/confirm`, which must be in the redirect allowlist; otherwise Supabase falls back to the Site URL.
2. `GET /auth/confirm` doesn't verify anything. It renders a page with one button, "Continue to Open Agent" (`id="auth-confirm-continue"`). Email scanners that pre-fetch links therefore can't burn the single-use token (Supabase's production checklist warns about this).
3. The button submits a server action that checks `type ∈ {"invite", "email"}` and `token_hash` matches `^[A-Za-z0-9_-]{10,200}$`, then calls `supabase.auth.verifyOtp({ type, token_hash })` on the server client. On success the session cookies are set. Then `redirect("/")`; there is no `next` parameter on this route.
4. The profile row already exists: `private.handle_new_user` created it when the invite created the user. `/` sees an empty profile and starts onboarding, as today.
5. On error (expired or used), redirect to `/login?error=link_expired`, which says: "That link has expired or was already used. Sign in with Google, or ask for a new link below." The email-link form is right there.

### 4. Google sign-in (returning users)

1. `/login` → **Continue with Google** (`id="login-google"`) submits a server action. It calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: APP_ORIGIN + "/auth/callback?next=" + safeNext, queryParams: { prompt: "select_account" } } })` on the server client (PKCE: the code verifier goes in an HttpOnly cookie), then `redirect(data.url)`.
2. Google → Supabase (`https://dwiuzfvmevdzzabqeaog.supabase.co/auth/v1/callback`) → `APP_ORIGIN/auth/callback?code=…&next=…`.
3. `/auth/callback` (route handler):
   - If the query has `error` / `error_code` / `error_description`, map them: `signup_disabled` or a 403 hook rejection → `/login?error=not_invited` ("This Google account isn't invited. Use the email you were invited with, or request access."); anything else → `/login?error=auth_failed`. The raw description is never echoed into the page.
   - `exchangeCodeForSession(code)`. On error → `/login?error=auth_failed`.
   - `next` is sanitized with `safeNext()` (see the threat table). Then redirect to `APP_ORIGIN + next`.
4. **Uninvited Google accounts:** with `disable_signup = true`, Supabase won't create a user. If sign-ups were ever re-enabled by mistake, the `before-user-created` hook still rejects any email not in `invited_emails`.
5. **Invited user with a Google account on the same email:** Supabase links identities with the same email automatically ("Supabase Auth automatically links identities with the same email address to a single user", Identity Linking docs). The invite user's email is confirmed once they've used the invite link, so the Google identity is linked to the existing user and no new user is created. If they try Google before using the invite link, the email is unconfirmed. Supabase docs say that when linking, unconfirmed identities on the existing user are removed. That is acceptable here, since there is no password identity to lose. The E2E plan covers both orders (see "Claims to verify during build").
6. `mailer_notifications_identity_linked_enabled = true`, so the user gets an email when Google is linked, which is a security signal.

### 5. Email sign-in link (users without Google)

1. On `/login`, "Email me a sign-in link" (`id="login-email"`) → server action → `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: APP_ORIGIN + "/auth/confirm" } })`.
2. The response is always "If that email has access, a link is on its way." Errors (including "signups not allowed") are logged at `info` without the email and never shown. This avoids enumeration.
3. Magic-link template: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`, then the same `/auth/confirm` flow as above. A `token_hash` link works in a different browser from the one that asked, unlike a PKCE `code` link.

### 6. Every request: session refresh and token forwarding

1. `web/proxy.ts` (Next 16 "proxy", formerly middleware) runs on every non-static path. It creates the server client with the request and response cookie adapters and calls `supabase.auth.getClaims()`. That verifies the access token locally against the cached JWKS and refreshes it with the refresh token if it has expired, writing the new cookies to both the request (so later server code sees them) and the response. There must be no code between `createServerClient` and `getClaims()`.
2. Route protection in `proxy.ts`:
   - Public paths: `/login`, `/request-access`, `/auth/callback`, `/auth/confirm`, `/auth/error`, `/_next/*`, `/favicon.ico`.
   - No valid claims on a page → `302 /login?next=<path>`. No valid claims on `/api/*` → `401 { error: "signed_out" }` (the client shows "You were signed out. Sign in again." with a link).
   - `/admin` and `/api/admin/*` without the admin claim → 404 (page) or 404 (API).
3. Server code that calls the agent uses `getAgentAuth()` (`web/lib/auth.ts`). It calls `getClaims()` (verified), then `getSession()` only to read `access_token`, returning `{ userId: claims.sub, accessToken }`. If either is missing, it throws `SignedOut`, which maps to 401.
4. `agentFetch(path, init)` (`web/lib/agentServer.ts`) sets `authorization: Bearer <accessToken>`, `x-agent-secret`, `cache: "no-store"`, and a timeout. It never forwards browser cookies or headers to the agent.
5. **CopilotKit / AG-UI:** `app/api/copilotkit/[[...slug]]/route.ts` stops caching one global handler. For each request it calls `getAgentAuth()`, then builds a `CopilotRuntime` with `new HttpAgent({ url: agentUrl("/agui"), headers: { authorization, "x-agent-secret" } })` and handles the request. If the CopilotKit runtime supports per-request headers natively (a header resolver or `properties`), use that instead of rebuilding the runtime; builder's call after checking the installed `@copilotkit/runtime` version. The agent checks the token once at run start. A run that outlives the token's `exp` keeps streaming, which is acceptable because the run started authorized.
6. **Vercel duration:** set `export const maxDuration = 300` (or the plan maximum) on the CopilotKit route. Long agent runs are cut off at that limit. See open questions.

### 7. Sign-out

`POST /auth/signout` (form button `id="header-signout"`, Origin checked) → `supabase.auth.signOut({ scope: "local" })` → clears the cookies → `303 /login`. Using `scope: "global"` instead signs out every device; builder's call. Default to local, and offer "Sign out everywhere" in the profile drawer (`id="profile-signout-all"`).

### 8. Deactivate, reactivate, delete

All of these are admin-only agent endpoints, with confirmation in the UI.

- **Deactivate** (`POST /admin/users/:id/deactivate`):
  1. `auth.admin.updateUserById(id, { ban_duration: "876000h" })`. Refresh fails from then on, so the session dies within `jwt_exp`.
  2. `update profiles set status='deactivated'`. RLS (`private.is_active()`) immediately hides all their rows from browser reads.
  3. The agent drops its status cache entry, disposes that user's live sessions, Chromium contexts and login flows, and evicts their `ProviderHub`.
  4. The agent checks status on every request (cache TTL 30 s), so any still-valid access token gets `403 { error: "account_disabled" }` within 30 s.
  An admin can't deactivate themselves (`409`).
- **Reactivate:** `ban_duration: "none"` and `status='active'`.
- **Delete** (`DELETE /admin/users/:id`, the UI requires typing the email):
  1. Deactivate first.
  2. List and remove all Storage objects under `artifacts/{id}/` (paged, 100 at a time; fail and stop if any removal errors).
  3. `delete from invited_emails where email = …`.
  4. `auth.admin.deleteUser(id)`. FKs cascade profiles, chats, messages, workspace, artifacts, settings and credentials.
  5. If any step fails, return an explicit error naming the step. Every step is idempotent, so retrying is safe.

### 9. Admin bootstrap (one time)

`supabase/scripts/bootstrap-admin.mjs` runs on the owner's machine with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (from `deploy-config/.env-agent`) and `ADMIN_EMAIL=ntnbhat9@gmail.com`:

1. `insert into invited_emails (email) values ($ADMIN_EMAIL) on conflict do nothing` (via PostgREST with the secret key).
2. If no user has that email, `auth.admin.createUser({ email, email_confirm: true, app_metadata: { role: "admin" } })`. If the user exists, `updateUserById(id, { app_metadata: { ...existing, role: "admin" } })`.
3. Print the user id and "Sign in with Google at APP_ORIGIN/login". No email is sent.

Because the email is created confirmed, the owner's first Google sign-in links automatically to this user. A second admin is made by rerunning the script with another email. There is no UI for granting admin, so promotion is deliberately out-of-band.

## Agent changes (module by module)

New dependencies: `@supabase/supabase-js` (latest 2.x), `jose` (latest 6.x). There is no separate Postgres driver.

### Config: `agent/src/config.ts`

Add these fields and remove `sharedSecret`, `sharedSecretFile`, `dataDir` and `artifactsDir`:

```
supabaseUrl: string                // SUPABASE_URL, required, must be https://<ref>.supabase.co
supabaseSecretKey: string          // SUPABASE_SECRET_KEY, required, must start with "sb_secret_"
serviceSecret: string              // AGENT_SERVICE_SECRET, required, ≥ 32 bytes of entropy (64 hex chars)
credentialKeys: { current: number; keys: Map<number, Buffer> }  // CREDENTIAL_KEYS
appOrigin: string                  // APP_ORIGIN, required, https origin, no path
accessRequestPepper: Buffer        // ACCESS_REQUEST_PEPPER, required, 32 bytes base64
```

`loadConfig` throws a single error listing every missing or invalid variable, by name only. The process exits non-zero, and compose shows the message. Startup also refuses to run if any known provider credential variable is set in the agent's environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `TYPESAFE_API_KEY`, and whatever else pi's provider definitions read; the builder generates the list from pi's catalog in a test). pi's api-key auth falls back to ambient env vars (`credential.key ?? env(...)`), so a stray server key would silently serve every user.

### Auth: `agent/src/auth/`

- `verify.ts`
  ```ts
  export type AuthUser = { id: string; email: string; sessionId: string; isAdmin: boolean };
  export function createVerifier(cfg): (token: string) => Promise<AuthUser>;
  ```
  - `createRemoteJWKSet(new URL(cfg.supabaseUrl + "/auth/v1/.well-known/jwks.json"), { cacheMaxAge: 600_000, cooldownDuration: 30_000, timeoutDuration: 5_000 })`.
  - `jwtVerify(token, jwks, { algorithms: ["ES256"], issuer: cfg.supabaseUrl + "/auth/v1", audience: "authenticated", requiredClaims: ["sub", "exp", "iat", "session_id", "role"], clockTolerance: 30 })`.
  - It then requires `role === "authenticated"`, `is_anonymous !== true`, `sub` a UUID, a token length of 8 KB or less, and `typ` absent or `JWT`. `isAdmin` comes from `app_metadata.role === "admin"`.
  - An unknown `kid` makes jose refetch the JWKS (cooldown-limited). `alg` is pinned, so `none`, `HS256` (key confusion) and `RS256` are rejected before any key lookup.
  - Errors become `AuthError("invalid_token" | "expired_token")`. The token is never logged; only its `kid`, plus `sub` once verified, at debug.
- `middleware.ts`
  - `requireService`: constant-time compare (`timingSafeEqual` on SHA-256 digests) of `x-agent-secret` with `cfg.serviceSecret`. Applied app-wide except `GET /health`. Failure → `401 { error: "unauthorized" }`.
  - `requireUser`: parses `Authorization: Bearer …`, verifies it, then checks `status.isActive(user.id)`. Sets `c.set("user", user)`. Missing or invalid → `401 { error: "signed_out" }` with `www-authenticate: Bearer error="invalid_token"`. Deactivated → `403 { error: "account_disabled" }`.
  - `requireAdmin`: `requireUser`, then `user.isAdmin`, then a live `auth.admin.getUserById` confirming the role and no ban (cached 30 s per admin). Otherwise `404 { error: "not_found" }` (hides that the endpoints exist).
- `status.ts`: `UserStatusCache` with `isActive(userId)` reading `profiles.status` (TTL 30 s; negative results cached 30 s too). `invalidate(userId)`. If the DB can't be reached → `503 { error: "auth_unavailable" }` (fail closed, never assume active).

The `x-agent-secret` header and the `Authorized` type in `http/handlers.ts` are replaced by Hono context variables (`c.get("user")`). `lib/secret.ts` and `ensureSharedSecret` are deleted.

### Database access: `agent/src/db/`

- `client.ts`: `createServiceClient(cfg)` → `createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { "x-client-info": "open-agent-agent" } } })`. Only `db/*` may import this. A test greps `agent/src` and fails if `db/client` is imported anywhere else.
- `users.ts`: `forUser(db, userId)` returns a frozen object of repositories, each with `userId` built in:
  - `profiles.get()` / `profiles.putData(data)`: `select data … eq user_id`, `update … eq user_id`. If the row is missing (it shouldn't be, given the trigger), `insert` it with the email from the token.
  - `chats.claim(chatId, { model })`: `insert … on conflict (id) do nothing`, then `select … eq id, eq user_id`. If no row comes back, the id belongs to someone else → throw `UserError("not_found")`. The caller returns `404 "This chat doesn't exist."` without saying whose it is.
  - `chats.touch(chatId, { title?, model? })`, `messages.append(chatId, runId, [{ role, content }])`, `messages.history(chatId, limit = 200)` (oldest first).
  - `workspace.get/list/put/remove/summary`: async versions of today's API, `rpc("workspace_put", …)` for `put`.
  - `artifacts.insert/get/setPdf`, `storage.upload/download` under `artifacts/${userId}/…` only. Paths are built here from `userId` and a validated artifact id, never passed in.
  - `providerSettings.get/put`, `credentials.read/list/modify/delete` (encrypted rows, see crypto).
- `admin.ts`: `accessRequests.insertPublic/listForIpWindow/decide`, `invited.add/remove`, `users.deactivate/reactivate/delete`. These are used only by `http/admin.ts` and `http/accessRequests.ts`.
- `errors.ts`: maps PostgREST and Storage errors to `UserError` (`P0409` → `VersionConflict`; `23505` → conflict; network or timeout → `unavailable`; anything else → logged with code, rethrown as `upstream`). Error messages from Supabase are never sent to the client verbatim.

Every repository call has a 10 s timeout through `AbortSignal.timeout`, and retries once on network errors for idempotent reads only.

### Crypto: `agent/src/crypto/`

```ts
export interface KeyWrapper {
  readonly currentVersion: number;
  wrap(dek: Buffer, aad: Buffer): Promise<{ wrapped: Buffer; nonce: Buffer; version: number }>;
  unwrap(wrapped: Buffer, nonce: Buffer, version: number, aad: Buffer): Promise<Buffer>;
}
export class LocalKeyWrapper implements KeyWrapper { /* AES-256-GCM with CREDENTIAL_KEYS */ }

export type Sealed = { ciphertext: Buffer; nonce: Buffer; dekWrapped: Buffer; dekNonce: Buffer; keyVersion: number };
export async function seal(w: KeyWrapper, plaintext: Buffer, ctx: { userId: string; provider: string; kind: string }): Promise<Sealed>;
export async function open(w: KeyWrapper, s: Sealed, ctx: { userId: string; provider: string; kind: string }): Promise<Buffer>;
```

- **`seal`:** `dek = randomBytes(32)`, `nonce = randomBytes(12)`, then AES-256-GCM encrypt the plaintext with the AAD below and append the 16-byte tag. Then `w.wrap(dek, aad)`, which uses a fresh random 12-byte nonce under master key `current`. Finally `dek.fill(0)`.
- **AAD:** `utf8("oab/credential/v1\0" + userId + "\0" + provider + "\0" + kind + "\0" + keyVersion)`. The same AAD is used for the value and for the wrapped DEK. Moving a row's bytes to another user, provider, kind or key version makes decryption fail. That failure is a hard error: log `[crypto] credential failed integrity check user=<id> provider=<p>` and treat the provider as not configured.
- **`CREDENTIAL_KEYS` format:** `v2:<base64 32 bytes>,v1:<base64 32 bytes>`. The first entry is current. Each key must decode to exactly 32 bytes, and versions must be unique positive integers. Generate with `openssl rand -base64 32`.
- **Plaintext lifetime:** decrypted values exist only inside `SupabaseCredentialStore.read/modify` calls and the pi runtime's in-memory auth for the duration of a call. Buffers are zeroed after use where we own them. Values are never logged; `log.ts` gains a `redact()` that masks anything matching `sk-…`, `sb_secret_…`, `Bearer …`, or JSON keys `apiKey|key|access|refresh|token|secret`, applied to every error object before it's logged.
- **Hint** (`hint.ts`): `hint(value)`. If the value is 20 characters or longer: the prefix up to and including the last `-` or `_` within the first 8 characters, plus `…`, plus the last 4 characters (`sk-ant-…a91f`, `sk-or-…77c2`). If it's shorter: `…` plus the last 2. OAuth credentials get `"Signed in"`, plus ` · <account email>` if the provider's token response includes one. The hint is computed before sealing and stored in clear.
- **Master-key rotation** (`agent/scripts/rotate-credentials.ts`, run via `docker compose exec agent node dist/agent/scripts/rotate-credentials.js`):
  1. Add `v(n+1)` as the first entry of `CREDENTIAL_KEYS` and keep the old ones. Restart the agent; new writes use the new key, and old rows still open.
  2. Run the script. It pages through `provider_credentials where key_version < current` (100 at a time) and, for each row, unwraps the DEK with the old version and rewraps it with the current one (new `dek_nonce`, new `key_version`, AAD recomputed). The value ciphertext is untouched because the DEK doesn't change. Each update is guarded by `eq version` (optimistic); a conflict is retried once.
  3. When the script reports `0 rows below current`, remove the old key from `CREDENTIAL_KEYS` and restart.
- **KMS later:** `KmsKeyWrapper` implements `wrap` / `unwrap` with AWS KMS `Encrypt` / `Decrypt` (EncryptionContext = the same AAD fields). `key_version` maps to a KMS key ARN alias version. Nothing else changes.

### Provider credentials and the per-user hub: `agent/src/providers/`

- `credentialStore.ts`: `SupabaseCredentialStore implements CredentialStore` (pi-ai). It is per user and per hub.
  - `read(id)`: select the row, `open`, then `JSON.parse` into pi's `Credential` (`{ type: "api_key", key } | { type: "oauth", refresh, access, expires, … }`).
  - `list()`: `select provider, kind` only, with no decryption.
  - `modify(id, fn)`: serialized per `(userId, provider)` with an in-process async mutex. Read current (decrypted), `next = await fn(current)`. If `next` is undefined, return current. Otherwise seal it and upsert with `version = version + 1 where version = <read version>`. On a version conflict, re-read and rerun `fn` once, then fail with `conflict`. pi runs OAuth refresh inside `modify`, so a refreshed ChatGPT token is written back encrypted.
  - `delete(id)`: delete the row (same mutex).
- `hub.ts`: `ProviderHub` stays mostly as it is, but `create()` takes `{ userId, settings repo, credentials: SupabaseCredentialStore, deviceId, gateway?: … }`. It calls `ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })` instead of `authPath`. `providers.json` becomes `provider_settings.data`, and `local-keys.json` becomes credential rows (`api_key` kind; provider id = the local provider id or `secret:brave-search`). `deviceId()` reads `provider_settings.device_id`. `lockAuthFile()` and file I/O are deleted. `list()` adds `hint?: string` per configured provider; the UI never receives anything else about the key.
- `hubs.ts`: `UserHubs`, an LRU of `ProviderHub` per user (max 200 entries, idle TTL 15 min). `get(userId)` builds lazily, with concurrent callers sharing the pending build. Any key or provider mutation calls `invalidate(userId)` *after* the write commits, and live sessions keep their own runtime until disposed.
- **LiteLLM operator gateway** (`LLM_API_KEY`): shown only to admin users. A hub built for a non-admin never registers it. This stops the operator's paid gateway from serving every invitee by default. (Open question 2 asks whether invitees should share it.)
- **Local or custom providers** (Ollama, llama.cpp, LM Studio, custom, OpenAI-compatible): on EC2 these are SSRF vectors. `addLocal` now calls `publicHttpUrlError(baseUrl)` and `resolvesInternal(host)` from `lib/net.ts`. Private, loopback, link-local and `host.docker.internal` targets are allowed only for admin users (so local development with Ollama still works for the owner). The check runs again each time a hub is built, because DNS can change. EC2 also gets IMDSv2 with hop limit 1 (see rollout), so a container can't reach instance metadata even if a check is bypassed.
- `logins.ts`: `LoginFlows.start(userId, providerId)`. Flows store `userId`; `get/answer/cancel(userId, flowId)` return "This sign-in expired" (404) when the flow belongs to a different user. Each user may have one running flow; globally, only one ChatGPT OAuth flow runs at a time (pi binds a fixed callback port 1455). A second user gets `409 "Another sign-in is in progress. Try again in a minute."` On EC2 the browser can't reach the container's `localhost:1455` callback, so the user pastes the final redirect URL into the existing `manual_code` prompt (`SignIn.tsx` already supports this). On success the credential is persisted by pi through `credentials.modify`, so it goes through the encrypted store.

### Profiles: `agent/src/profile/store.ts`

`ProfileStore` becomes per user: `interface ProfileStore { get(): Promise<Profile>; put(input: unknown): Promise<Profile> }`, obtained via `profiles(userId)`. `SupabaseProfileStore` uses `forUser(db, userId).profiles`: `parseProfile(row.data) || emptyProfile()` on read; `parseProfile(input)` then `putData` on write, with `UserError("that profile isn't valid")` as today. `FileProfileStore` is deleted. `MemoryProfileStore` stays for tests. `withStoredProfile` takes the per-user store.

### Chats and sessions: `agent/src/session/`, `agent/src/agui/`, `agent/src/chats/`

- `http/agui.ts`: `POST /agui` gets `requireUser`. `threadId` must be a UUID (otherwise 400). Before any work: `chats.claim(threadId, { model })`. If it's owned by someone else, the stream emits `RUN_ERROR NOT_FOUND "This chat doesn't exist."`
- `SessionStore` keys entries by `${userId}:${threadId}`. `getOrCreate(user, threadId, …)`. A user can have at most 3 live sessions; the least recently used idle one is disposed when a fourth starts. A global cap of 50 live sessions returns `RUN_ERROR BUSY "The agent is at capacity. Try again shortly."` past that.
- **History:** when a session is created for an existing chat, `messages.history(chatId)` is the source of truth. `restoreHistory(input.messages)` is no longer used for seeding, because client-supplied history could be forged. The client's messages still drive the UI.
- **Persistence:** at run start, append the user message. At `RUN_FINISHED`, append the final assistant text (the same text the translator emitted, without the `<followups>` line) and `chats.touch(threadId, { title: first 80 chars of the first user message if title is empty })`. Tool payloads and widgets are not persisted in this version; reopening a chat shows text only. Builder's call: persist widget payloads in a `parts jsonb` column later.
- `createSession.ts`: `sessionFactory` takes `user` and gets `hub = await hubs.get(user.id)`. Judge resolution becomes per hub: `judgeResolver` is cached per user hub, and the global `JEV_CONCURRENCY` limiter stays shared. `braveApiKey` comes from that hub's `secret("brave-search")`. `BrowserPool` contexts are keyed by `${userId}:${threadId}`.

### Workspace: `agent/src/workspace/`

`WorkspaceStore` becomes an interface with async methods and a `forChat(userId, chatId)` binding: `get(kind, id)`, `list(kind?)`, `put(kind, id, value, expectedVersion?)`, `remove(kind, id)`, `summary()`. `SupabaseWorkspaceStore` implements it through the repositories, and `MemoryWorkspaceStore` serves tests. Every caller becomes async: `workspace/cart.ts`, `workspace/edits.ts`, `tools/plan.ts`, `tools/index.ts`, `agui/runHandler.ts`, `session/createSession.ts` (`contextNote` becomes async; if pi's `contextNote` hook is sync, precompute the note at run start and after each workspace write, and return the cached string). `node:sqlite` usage is deleted.

### Artifacts: `agent/src/artifacts/store.ts`, `agent/src/http/artifacts.ts`

- `save(userId, chatId, title, html)`: reject HTML over 5 MB. `id = randomBytes(9).toString("base64url")`. Upload to `artifacts/${userId}/${id}.html` with `contentType: "text/html; charset=utf-8"` and `upsert: false`, then insert the row. If the insert fails, delete the uploaded object.
- `get(userId, id)`: validate `ARTIFACT_ID_RE`, select the row `eq user_id`, then download `html_path`. A missing row → 404, the same for "someone else's" and "doesn't exist".
- `renderPdf(userId, id)`: if `pdf_path` is set, download it. Otherwise render (as now, with `blockInternalRequests`), upload `…/${id}.pdf`, and set `pdf_path`. Concurrency stays limited to 2.
- The `create_artifact` tool gets `userId` and `chatId` from the session.
- `GET /artifacts/:file` gets `requireUser` and serves with `content-security-policy: ARTIFACT_CSP`, `x-content-type-options: nosniff`, `cache-control: private, no-store`.

### Admin and access-request endpoints: `agent/src/http/admin.ts`, `agent/src/http/accessRequests.ts`

| Method & path | Guard | Body / query | Response |
| --- | --- | --- | --- |
| `POST /access-requests` | service | `{ name, email, note }`, header `x-client-ip` | `202 { ok: true }` always (unless the body is malformed → 400) |
| `GET /admin/access-requests` | admin | `status=pending|approved|rejected|all`, `page≥1` | `{ items: [...5], total, page, pageSize: 5 }`, newest first (`created_at desc, id desc`) |
| `POST /admin/access-requests/:id/approve` | admin | — | `200 { request }`, `409` if already decided, `502` if the invite email failed (row still updated) |
| `POST /admin/access-requests/:id/reject` | admin | — | `200 { request }`, `409` |
| `POST /admin/access-requests/:id/resend` | admin | — | `200`, `409` if not approved |
| `GET /admin/users` | admin | `page≥1`, `q` (email prefix, optional) | `{ items: [...5], total, page, pageSize: 5 }` from `profiles`, joined with `auth.admin` for `last_sign_in_at` and the providers list |
| `POST /admin/users/:id/deactivate` / `reactivate` | admin | — | `200`; `409` for self |
| `DELETE /admin/users/:id` | admin | `{ confirmEmail }` must equal the user's email | `200`; a `5xx` names the failed step |

The web admin page can read lists directly via RLS (below). The agent list endpoints exist for the users list, which needs `auth.admin` fields, and for tests. Builder's call: use RLS for the requests list and the agent for the users list.

### Rate limits: `agent/src/lib/rateLimit.ts`

An in-memory sliding window keyed by string. That is acceptable because there is one agent instance; the shared DB-backed limit is only needed for access requests, which already use the DB. Limits (builder may tune):

| Key | Limit |
| --- | --- |
| `run:<user>` | 30 runs / 10 min, 2 concurrent |
| `keys:<user>` (key set/delete, local provider add, provider test) | 20 / hour |
| `login:<user>` | 5 / 10 min |
| `profile:<user>` (PUT) | 60 / hour |
| `places:<user>`, `options:<user>` | 120 / 10 min |
| `admin:<user>` | 120 / 10 min |
| Access requests | in DB: 3/hour and 10/day per ip_hash, 200/day global |

Exceeding a limit → `429 { error: "rate_limited", retryAfter }` with a `Retry-After` header. The web shows "Slow down: try again in N s." and never retries automatically.

### Other agent routes

`/models`, `/providers/*`, `/settings/*`, `/profile`, `/places`, `/onboarding/options` all get `requireUser` and operate on `hubs.get(user.id)` and `profiles(user.id)`. The response shapes stay the same apart from the new `hint` on providers.

### Errors and logging

- `safe()` keeps mapping `UserError` to its status. New kinds: `unauthorized` → 401, `forbidden` → 403, `rate_limited` → 429.
- Log lines carry `user=<uuid>` (never email), `thread=`, `run=`. At `LOG_LEVEL=debug`, prompts and the profile are still logged as today (the README warns). Tokens, keys, ciphertext and `Authorization` headers are never logged at any level, and `redact()` is applied in `log.error`.

### Evals

`agent/evals/run.ts` drops `readSecret` from the container. It reads `AGENT_SERVICE_SECRET` and an access token for a dedicated eval user. The token is minted by `agent/evals/auth.ts`: with the secret key, `auth.admin.generateLink({ type: "magiclink", email: EVAL_USER_EMAIL })`, then `verifyOtp({ type: "email", token_hash })` with the publishable key, which returns a session. The eval user is created once by `bootstrap-admin.mjs --user <email>` (not admin) and needs its own provider key added through the app.

## Web changes

New dependency: `@supabase/ssr` (latest), `@supabase/supabase-js` (latest 2.x).

| File | Change |
| --- | --- |
| `web/lib/supabase/server.ts` | `createClient()` → `createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll, setAll }, cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/" } })`. `setAll` swallows the error thrown in Server Components (proxy handles refresh). |
| `web/lib/supabase/proxy.ts` | `updateSession(request)`, exactly the documented pattern, with `getClaims()` immediately after client creation; returns `{ response, claims }`. |
| `web/proxy.ts` | Calls `updateSession`, then enforces the public/protected/admin rules from flow 6. Matcher excludes `_next/static`, `_next/image`, `favicon.ico` and image extensions. |
| `web/lib/auth.ts` | `getClaimsOrNull()`, `requireUser()` (redirects to `/login`), `requireAdmin()` (`notFound()`), `getAgentAuth()` (above), `safeNext(raw)`. |
| `web/lib/agentServer.ts` | Delete the secret-file reading. `agentHeaders(auth)` → `{ authorization, "x-agent-secret": process.env.AGENT_SERVICE_SECRET }`. `forwardToAgent(req, path)` calls `getAgentAuth()` first (401 if signed out), checks `Origin` equals `APP_ORIGIN` for non-GET methods (403 otherwise), and forwards only `content-type` and the body. `AGENT_SERVICE_SECRET` missing → throw at module load in production. |
| `web/app/api/*/route.ts` (profile, providers, settings, models, places, onboarding/options, artifacts) | Go through `forwardToAgent` / `agentFetch` with auth. The artifacts route keeps the CSP and `nosniff` and adds `cache-control: private, no-store`. |
| `web/app/api/copilotkit/[[...slug]]/route.ts` | Per-request runtime or headers (flow 6), plus `maxDuration`. |
| `web/app/login/page.tsx` + `actions.ts` | Google button and email-link form. Error banner mapped from `?error=` (`not_invited`, `link_expired`, `auth_failed`, `signed_out`), with fixed copy only. Link to `/request-access`. A signed-in visitor is redirected to `/`. |
| `web/app/request-access/page.tsx` + `actions.ts` | The form and honeypot from flow 1. On submit, the same thank-you state is shown no matter what happened. |
| `web/app/auth/callback/route.ts` | Flow 4. |
| `web/app/auth/confirm/page.tsx` + `actions.ts` | Flow 3 (button, then `verifyOtp`). |
| `web/app/auth/signout/route.ts` | Flow 7 (POST only). |
| `web/app/admin/page.tsx`, `web/components/admin/RequestsList.tsx`, `UsersList.tsx`, `ConfirmDialog.tsx` | Tabs: **Requests** (filter: Pending, Approved, Rejected, All) and **Users**. Each list shows 5 rows per page, newest first, with "Showing 1–5 of 16" and Previous/Next, via `.range()` + `count: "exact"`. Each row has **View** (expands name, email, note, IP-hash prefix, dates, invite status and error) and the actions (Approve / Reject / Resend; Deactivate / Reactivate / Delete). Destructive actions open a confirm dialog; Delete requires typing the email. Errors render inline on the row (`role="alert"`) with the agent's message, and a failed action never looks successful. Empty states: "No pending requests." |
| `web/components/chat/RecentChats.tsx` | In the header or drawer: the user's chats, 5 per page, newest first ("5 of 16"), read via RLS in a server action. Selecting one sets `threadId` and loads its messages (text only) into the chat view. Builder's call on placement. |
| `web/components/profile/models/ProviderRow.tsx`, `ProviderForms.tsx`, `SearchSettings.tsx` | Show `hint` (e.g. `sk-ant-…a91f`) instead of only "configured". Key inputs are `type="password"`, `autocomplete="off"`, and clear after save; there is no "show key". **Replace key** and **Remove** stay as they are. |
| `web/components/Chat.tsx` | Header gets the user's email, plus a sign-out button and an "Admin" link if admin (`id="header-admin-link"`). The 401 `signed_out` response from any API → banner with a sign-in link. 403 `account_disabled` → full-page "Your access has been turned off." |
| `web/next.config.ts` | `headers()` for all routes: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Frame-Options: DENY` (except `/api/artifacts/*`, which uses `frame-ancestors 'self'` in its own CSP). |
| CSP | Set in `proxy.ts` with a per-request nonce: `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com https://dwiuzfvmevdzzabqeaog.supabase.co; base-uri 'none'; object-src 'none'`. The theme script in `layout.tsx` gets the nonce. `connect-src 'self'` works because no browser code talks to Supabase or the agent directly. Tune for Next/CopilotKit in development (`'unsafe-eval'` only in dev). |

Every new element gets a unique `id` (project rule) with prefixes `login-`, `request-access-`, `auth-confirm-`, `admin-requests-`, `admin-users-`, `recent-chats-`, `header-`. Row ids include the record id (`admin-requests-row-<uuid>`, `admin-requests-approve-<uuid>`).

`docker-compose.yml`'s `shared` volume mount and `agentsecret` group in `web/Dockerfile` are removed.

**Vercel monorepo note:** the Vercel project's Root Directory is `web`, with "Include files outside the root directory" enabled, because `web` imports `@shared/*` and `next.config.ts` sets `outputFileTracingRoot` to the repo root.

## Supabase configuration script

`supabase/scripts/configure-auth.mjs`: plain Node 22, no dependencies, idempotent. Run it with:

```
set -a; . deploy-config/env-files/.env-supabase-admin; set +a
node supabase/scripts/configure-auth.mjs --check     # prints a masked diff, exit 1 on drift
node supabase/scripts/configure-auth.mjs --apply     # PATCHes only changed fields, then re-checks
```

What it does:

1. `GET https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`.
2. Builds the desired object below and diffs it field by field. Secret fields (`smtp_pass`, `external_google_secret`) can't be compared because the GET returns them redacted or null. They are sent on `--apply` when `--rotate-secrets` is passed or the current value is null. The script prints `smtp_pass: <set>` and never the value.
3. `PATCH /v1/projects/{ref}/config/auth` with only the differing fields.
4. Signing keys: `GET /v1/projects/{ref}/config/auth/signing-keys`. It asserts that exactly one key is `in_use` with `algorithm: "ES256"` (true today: ES256 `18b8d44a…` in use, legacy HS256 `4f3b737b…` previously_used). It never rotates automatically.
5. Legacy API keys: `GET /v1/projects/{ref}/api-keys/legacy`. If they are enabled, `--apply --disable-legacy-keys` calls `PUT …/api-keys/legacy?enabled=false`, and then `PATCH …/config/auth/signing-keys/{legacy_hs256_id}` with `{ "status": "revoked" }` (Supabase requires the legacy keys to be disabled before the legacy secret can be revoked). This is a separate flag because it can't be undone casually. Do it in rollout step 2, before any user exists.

Desired auth config. Field names were checked against the live GET and the Management API's `UpdateAuthConfigBody`:

| Field | Value | Note |
| --- | --- | --- |
| `site_url` | `$SITE_URL` (prod Vercel origin; `https://app.localhost` until it exists) | Fallback when `redirectTo` isn't allowlisted |
| `uri_allow_list` | `https://app.localhost/auth/callback,https://app.localhost/auth/confirm,$PROD_ORIGIN/auth/callback,$PROD_ORIGIN/auth/confirm` | Exact URLs, no wildcards; Vercel preview URLs are deliberately excluded |
| `disable_signup` | `true` | |
| `external_email_enabled` | `true` | Needed for invite and magic link |
| `mailer_autoconfirm` | `false` | |
| `external_anonymous_users_enabled` | `false` | Already false |
| `external_phone_enabled` | `false` | |
| `external_google_enabled` | `true` | |
| `external_google_client_id` | `$GOOGLE_CLIENT_ID` | |
| `external_google_secret` | `$GOOGLE_CLIENT_SECRET` | Secret |
| `external_google_email_optional` | `false` | |
| `security_manual_linking_enabled` | `false` | |
| `mailer_notifications_identity_linked_enabled` | `true` | |
| `mailer_notifications_identity_unlinked_enabled` | `true` | |
| `jwt_exp` | `900` | 15 min; bounds the window after deactivation (with the 30 s agent status check as the tighter guard) |
| `refresh_token_rotation_enabled` | `true` | Already true |
| `security_refresh_token_reuse_interval` | `10` | Already 10 |
| `sessions_timebox` | 30 days | Units must be confirmed against the dashboard before applying |
| `sessions_inactivity_timeout` | 7 days | Same caveat |
| `mailer_otp_exp` | `3600` | 1 h for invite and magic links; admin can resend |
| `mailer_otp_length` | `8` | Already 8 (unused; links only) |
| `rate_limit_email_sent` | `30` | Per hour; the default 2 only applies to built-in SMTP |
| `smtp_host` | `smtp.resend.com` | |
| `smtp_port` | `"465"` | String in the API |
| `smtp_user` | `resend` | |
| `smtp_pass` | `$RESEND_API_KEY` | Secret, send-only key |
| `smtp_admin_email` | `$SMTP_SENDER_EMAIL` (= `onboarding@resend.dev`) | |
| `smtp_sender_name` | `Open Agent` | |
| `smtp_max_frequency` | `60` | Seconds between emails to the same address |
| `mailer_subjects_invite` | `You're invited to Open Agent` | |
| `mailer_templates_invite_content` | contents of `supabase/templates/invite.html` | |
| `mailer_subjects_magic_link` | `Your Open Agent sign-in link` | |
| `mailer_templates_magic_link_content` | contents of `supabase/templates/magic_link.html` | |
| `hook_before_user_created_enabled` | `true` | |
| `hook_before_user_created_uri` | `pg-functions://postgres/private/before_user_created` | Needs migration 3 first. Before enabling the hook, the script runs `select to_regprocedure('private.before_user_created(jsonb)') is not null` through `POST /v1/projects/{ref}/database/query/read-only` and refuses if the function is missing, because a missing hook function breaks every sign-up path |
| `security_captcha_enabled` | `false` | See open questions |
| `password_min_length` | `12` | Defense in depth; no flow sets a password |

**Templates** (`supabase/templates/*.html`): short, plain HTML and inline styles, no images, no tracking. Invite:

```html
<h2>You're invited to Open Agent</h2>
<p>{{ .Data.name }}, your request was approved. This link signs you in and expires in one hour.</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Accept the invite</a></p>
<p>After this, sign in with Google using this email ({{ .Email }}), or ask for an email link on the sign-in page.</p>
<p>If you didn't ask for access, ignore this email.</p>
```

Magic link: the same structure with `type=email` and "Sign in to Open Agent". Builder's call on the exact copy. `{{ .Data.name }}` comes from the `data` passed to `inviteUserByEmail`; if it's empty, the template should still read naturally ("Hi, your request…").

**Switching to a verified domain later** is four settings plus DNS: verify the domain in Resend (SPF/DKIM records), then set `smtp_admin_email` (e.g. `hello@<domain>`) and `smtp_sender_name` in the script's env, and rerun `--apply`. If the owner creates a new domain-scoped Resend key, also update `RESEND_API_KEY` (`smtp_pass`, with `--rotate-secrets`). If the site moves, update `site_url` / `uri_allow_list` too. Code doesn't change.

**Google Cloud console** (owner, by hand; we can't read it): OAuth client type "Web application", Authorized redirect URI `https://dwiuzfvmevdzzabqeaog.supabase.co/auth/v1/callback`, and the consent screen published (or the owner's and testers' accounts added as test users while in testing mode).

Migrations are applied with MCP `apply_migration` (one call per file, same name), then `list_migrations` and `get_advisors` confirm. The script does not apply SQL.

## Caddy and docker compose

### Files

- `deploy-config/caddy/Caddyfile.local`:
  ```
  {
    admin off
    local_certs
  }

  (agent_common) {
    request_body {
      max_size 2MB
    }
    @public_health {
      path /health
      not remote_ip private_ranges
    }
    respond @public_health 404
    header {
      Strict-Transport-Security "max-age=63072000"
      X-Content-Type-Options nosniff
      Referrer-Policy no-referrer
      -Server
    }
    reverse_proxy agent:8000 {
      flush_interval -1
      transport http {
        read_timeout 15m
        write_timeout 15m
      }
    }
  }

  app.localhost {
    encode zstd gzip
    reverse_proxy web:3000
  }

  agent.localhost {
    import agent_common
  }
  ```
- `deploy-config/caddy/Caddyfile.ec2`: global options `{ admin off; email {$ACME_EMAIL} }` (automatic Let's Encrypt), the same `(agent_common)` snippet, and one site `{$AGENT_HOST} { import agent_common }`. There is no `app` site because web is on Vercel.
- `flush_interval -1` is required so AG-UI SSE isn't buffered. The timeouts cover long runs.

### `docker-compose.yml`

- New `caddy` service: `caddy:2.10` pinned by digest, ports `80:80` and `443:443` (on EC2 public; locally `127.0.0.1:443:443` and `127.0.0.1:80:80`), volumes `./deploy-config/caddy/${CADDYFILE:-Caddyfile.local}:/etc/caddy/Caddyfile:ro`, `caddy-data:/data`, `caddy-config:/config`. Env `AGENT_HOST` and `ACME_EMAIL` from `deploy-config/.env-caddy` (optional, not secret). `depends_on: agent (healthy)`.
- `agent`: drop the `agent-data`, `artifacts-data` and `shared` volumes and the port `1455` mapping (sign-in uses the pasted redirect). Add `read_only: true`, `tmpfs: ["/tmp:size=512m,mode=1777"]` (pi scratch and Chromium; Playwright may also need `/home/pwuser/.cache` as tmpfs, so the builder verifies), `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`. Keep `127.0.0.1:8000:8000` for local debugging; it's harmless on EC2 because it's bound to loopback. `env_file: deploy-config/.env-agent` becomes **required**.
- `web`: `profiles: ["local"]`, so it only runs locally. `env_file: deploy-config/.env-nextjs` becomes required. Drop the `shared` volume. `AGENT_URL` stays `http://agent:8000` (container to container). The browser reaches web only through `https://app.localhost`, and the `3000` port mapping is removed to force the Caddy path.
- `search`: the published port is removed (only the agent needs it, over the compose network).
- Volumes: remove `agent-data`, `artifacts-data`, `shared`; add `caddy-data`, `caddy-config`.
- `agent/Dockerfile`: remove the `agentsecret` group and `/data/*` dirs. `web/Dockerfile`: remove the group.

Local run: `docker compose --profile local up -d`. EC2: `CADDYFILE=Caddyfile.ec2 docker compose up -d`.

**Local TLS trust (one time):** `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt`. Chrome resolves `*.localhost` to 127.0.0.1 without editing `/etc/hosts`. For `curl` and Node, use `--resolve app.localhost:443:127.0.0.1` or add hosts entries.

### Cookies and CORS

- Auth cookies live only on the web origin (`app.localhost` / the Vercel domain), host-only (no `Domain` attribute), `HttpOnly; Secure; SameSite=Lax; Path=/`. The agent domain never sees a browser cookie.
- The agent sends **no** CORS headers and answers `OPTIONS` with 405. Browsers therefore can't call it cross-origin, and only server-side callers with the service secret can.
- Because web and agent are on different sites (Vercel vs EC2 domain), nothing depends on cross-site cookies or third-party cookie policies.

## Environment variables

`S` = secret (never committed, never `NEXT_PUBLIC_`, never logged).

### Agent: `deploy-config/.env-agent` (local and EC2)

| Variable | S | Example / format |
| --- | --- | --- |
| `SUPABASE_URL` | | `https://dwiuzfvmevdzzabqeaog.supabase.co` |
| `SUPABASE_SECRET_KEY` | S | `sb_secret_…` (the `default` secret key; create a dedicated `agent` secret key so it can be rotated alone) |
| `AGENT_SERVICE_SECRET` | S | 64 hex chars (`openssl rand -hex 32`); same value in web |
| `CREDENTIAL_KEYS` | S | `v1:<base64 32 bytes>` |
| `ACCESS_REQUEST_PEPPER` | S | base64 32 bytes |
| `APP_ORIGIN` | | `https://app.localhost` locally; `https://<vercel domain>` on EC2 |
| `LOG_LEVEL`, `JEV_MODEL`, `JEV_CONCURRENCY`, `AGENT_MODEL_CAPS` | | unchanged |
| `LLM_API_KEY` | S | optional, admin-only gateway |
| `LLM_BASE_URL`, `AGENT_MODELS` | | unchanged |

Removed: `AGENT_SHARED_SECRET`, `AGENT_SECRET_FILE`, `AGENT_DATA_DIR`, `ARTIFACTS_DIR`.

If local and EC2 share the one Supabase project (as they will at first), `CREDENTIAL_KEYS` **must be identical** in both, or each side sees the other's keys as corrupt. See open question 1.

### Web, local: `deploy-config/.env-nextjs`

| Variable | S | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | | `https://dwiuzfvmevdzzabqeaog.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | | `sb_publishable_…` (public by design) |
| `APP_ORIGIN` | | `https://app.localhost` |
| `AGENT_URL` | | set by compose: `http://agent:8000` |
| `AGENT_SERVICE_SECRET` | S | same as agent |

### Vercel (Production environment only; Preview gets none, so previews can't sign in)

| Variable | S | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | | as above |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | | as above |
| `APP_ORIGIN` | | `https://<vercel domain>` |
| `AGENT_URL` | | `https://<AGENT_HOST>` |
| `AGENT_SERVICE_SECRET` | S | marked Sensitive in Vercel |

### Supabase admin scripts: `deploy-config/env-files/.env-supabase-admin` (owner's machine only)

| Variable | S | Note |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | S | Management API personal token |
| `SUPABASE_PROJECT_REF` | | `dwiuzfvmevdzzabqeaog` |
| `GOOGLE_CLIENT_ID` | | (exists) |
| `GOOGLE_CLIENT_SECRET` | S | (exists) |
| `RESEND_API_KEY` | S | (exists), send-only |
| `SMTP_SENDER_EMAIL` | | `onboarding@resend.dev` |
| `SITE_URL` | | prod origin once known |
| `PROD_ORIGIN` | | Vercel origin (blank until known; the script omits it) |

`bootstrap-admin.mjs` reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from `.env-agent` and `ADMIN_EMAIL` from the command line.

### Caddy: `deploy-config/.env-caddy` (EC2)

`AGENT_HOST`, `ACME_EMAIL` (not secret).

`.gitignore` already covers `deploy-config/.env*` and `deploy-config/**/.env*`. Commit example files with names only and no values: `deploy-config/env.examples/agent.env.example`, `nextjs.env.example`, `caddy.env.example`, `supabase-admin.env.example`. They go in a separate folder because `.env*.example` names under `deploy-config/` would be caught by the ignore rule.

## Security model and threats

Principles: the user id comes only from a verified token; the service secret plus the token are both required; deny by default (RLS, Storage, CORS); fail closed; secrets stay server-side; least privilege for every key.

| Threat | Mitigation |
| --- | --- |
| Uninvited sign-up via Google or OTP | `disable_signup`, plus the `before-user-created` hook allowlist, plus `shouldCreateUser: false` on OTP. Tested in E2E with a non-invited Google account. |
| Admin privilege escalation | Role lives in `app_metadata` (only service role can write). Admin endpoints re-check live with `getUserById`. RLS admin policies read the JWT's `app_metadata`. There is no UI to grant admin. |
| Forged or confused JWT (`alg: none`, HS256 with public key, RS/ES swap, other project's token) | `algorithms: ["ES256"]` pinned in `jose`; key only from the project's JWKS; `iss` exact; `aud = authenticated`; `role = authenticated`. Legacy HS256 secret revoked and legacy keys disabled (rollout). Unit tests for each case. |
| Stolen access token used directly against the agent | Agent requires the service secret too, which isn't in the browser. Tokens last 15 min. Agent sends no CORS. |
| IDOR on chats, artifacts, workspace, login flows | Ownership claimed in the DB (`chats.claim`); every repository query has `eq user_id`; composite FKs; sessions keyed by user+chat; login flows bound to the user; 404 for "not yours". RLS tests prove it. |
| RLS gaps | RLS on every table, explicit grants, no write policies, `private.is_active()` in every own-row policy, `get_advisors` after each migration, a SQL test suite (below) that enumerates every table in `public` and fails if any lacks RLS or has a policy for `anon`. |
| Secret key misuse in agent code | Single `db/client.ts`, exported only into `db/`; a lint test enforces this; repositories require `userId` at construction. |
| Key exfiltration from DB or backups | Envelope AES-256-GCM; master key only in agent env; AAD binds the row; ciphertext useless without `CREDENTIAL_KEYS`. |
| Key leakage to browser or logs | No endpoint returns keys; the UI shows only hints; `redact()` on logged errors; the pi runtime is in memory; debug logs are documented as containing prompts, never credentials. A unit test logs an error containing a fake key and asserts it's masked. |
| Ambient server credentials serving all users | Startup refuses when provider key env vars are present; the LiteLLM gateway is admin-only. |
| CSRF | SameSite=Lax cookies; Next server actions check Origin/Host; `forwardToAgent` checks `Origin === APP_ORIGIN` on non-GET; sign-out is POST-only. |
| Open redirect via `next` | `safeNext(raw)`: must start with a single `/`, not `//` or `/\`, no control chars, at most 512 chars; `new URL(raw, APP_ORIGIN).origin === APP_ORIGIN`; path must match an allowlist (`/`, `/admin`, `/admin/*`). Otherwise `/`. The redirect target is always built from `APP_ORIGIN`, never from the `Host` header. Supabase's `uri_allow_list` is exact URLs. Unit tests cover `//evil.com`, `/\evil.com`, `https://evil.com`, `/%2F%2Fevil.com`, `javascript:`. |
| Magic-link token prefetch by email scanners | `/auth/confirm` requires a button click (POST) before `verifyOtp`. |
| Token leakage in URLs | Only one-time `token_hash` / `code` appear in URLs, and they're stripped by redirecting immediately after use. `Referrer-Policy: strict-origin-when-cross-origin`. No access tokens in URLs or query strings ever. |
| Enumeration via request-access or email login | Identical response and padded latency; no read-back; DB rate limits by IP hash; OTP errors never surfaced. |
| Request-access spam or flood | Honeypot, minimum fill time, per-IP and global daily caps in DB, unique pending per email, lengths limited by DB checks. Optional Turnstile (open question). |
| SSRF via custom provider base URLs | Public-only for non-admins, re-checked at hub build; IMDSv2 hop limit 1 on EC2; compose network has nothing sensitive besides SearXNG. Existing `fetchPublic` and browser guard rules unchanged. |
| Long-lived session after deactivation | Ban (no refresh), `status` check on every agent request (≤30 s), RLS `is_active()`, `jwt_exp = 900`. |
| XSS in the web app | CSP with nonce and `strict-dynamic`; React escaping; artifacts only in a sandboxed iframe with `sandbox` CSP and no `allow-same-origin`. |
| Clickjacking | `frame-ancestors 'none'` (artifacts: `'self'`). |
| Cookie theft | HttpOnly, Secure, SameSite=Lax, host-only; HSTS on both origins. |
| Agent exposed on EC2 | Only Caddy is public (80/443); security group allows 22 from the owner's IP only; the agent container runs read-only with no caps and no volumes; Caddy limits body size. |
| Supabase outage | Agent returns 503 `auth_unavailable` or `storage unavailable`; web shows "Can't reach the account service. Try again." No fallback to unauthenticated. |
| Replay of a pending ChatGPT OAuth paste across users | Flows bound to the user; one global ChatGPT flow at a time; PKCE state tied to the flow. |
| Vercel preview deployments | No env vars in Preview, and their URLs aren't in `uri_allow_list`, so previews can't authenticate or reach the agent. |

## Testing

### Unit (vitest, no network)

- **Agent `crypto/`:** seal/open round trip; tampering with each field (ciphertext, nonce, dek_wrapped, dek_nonce, key_version) fails; moving a sealed row to another `userId` or `provider` fails; rotation rewrap keeps plaintext; `CREDENTIAL_KEYS` parsing rejects 31/33-byte keys and duplicate versions; `hint()` cases.
- **Agent `auth/verify`:** a locally generated ES256 keypair served by a fake JWKS (inject a `fetch`). Valid passes. Rejected: `alg: none`, HS256 signed with the public key bytes, RS256, wrong `iss`, wrong `aud`, `role: anon`, `is_anonymous: true`, expired beyond tolerance, unknown `kid` (one refetch, then fail), oversize token.
- **Agent middleware:** missing or wrong `x-agent-secret` → 401 before any token parsing; deactivated → 403; status DB down → 503.
- **Agent with `Memory*` stores:** session keying (`userA:t1` vs `userB:t1` are distinct), login-flow ownership, rate limiter windows, `safe()` mappings, the startup refusal on ambient provider env vars, the `db/client` import lint test, `ENTITY_KINDS` vs the SQL `check` list.
- **Web:** `safeNext` cases; login error mapping; `forwardToAgent` Origin check and header set (no cookie forwarding); admin list pagination text ("Showing 6–10 of 16"); every new component renders unique ids (extend the existing id-uniqueness checks in `web/test`).

### Integration against Supabase (`agent/test/supabase/*.int.test.ts`, run when `SUPABASE_INTEGRATION=1`)

They run against the real project with throwaway users `oab-test+<uuid>@example.test`. Before creating each user, they insert it into `invited_emails`. They create users with `auth.admin.createUser({ email_confirm: true })` (no email sent) and get sessions via `generateLink` + `verifyOtp`. Each test deletes everything it created in `afterAll` using the delete-user flow. Covered:

- the profile trigger creates a row; `SupabaseProfileStore` round trip; an invalid profile is rejected;
- `SupabaseCredentialStore` read/modify/delete with real bytea round trip, plus concurrent `modify` (two callers, one wins, other retries);
- `workspace_put` version semantics, including a conflict and a cross-user id collision (user B can't overwrite user A's `(chat, kind, id)`);
- `chats.claim` ownership;
- artifacts upload, get and PDF caching, and Storage cleanup on delete;
- the hook: `auth.admin.createUser` for a non-invited email fails with the hook's message (this also records whether the hook fires on admin creation; see claims to verify);
- `disable_signup`: `signInWithOtp({ shouldCreateUser: true })` for a new email fails.

### RLS tests (`supabase/tests/rls.test.ts`)

Two users A and B, each with a session from `generateLink`, and a publishable-key client per user:

- for every table, A sees only A's rows, B sees only B's, and anon sees nothing;
- every `insert`, `update` and `delete` from A or B on every table is denied (error or 0 rows), including `provider_credentials`, `invited_emails` and `access_requests`;
- A can't call `workspace_put` (permission denied);
- the admin sees `access_requests` and all `profiles`; a non-admin sees no `access_requests`;
- after deactivating A, A's still-valid token reads 0 rows everywhere;
- Storage: A's and B's clients can't list or download `artifacts/*`;
- a catalog check (SQL via the secret key on `pg_class` / `pg_policies`): every `public` table has `relrowsecurity = true`, and no policy targets `anon` or `public`.

### End-to-end (manual plus scripted, local compose with Caddy)

Prerequisites: migrations applied, `configure-auth.mjs --apply`, `.env-agent` and `.env-nextjs` filled in, Caddy root trusted, `bootstrap-admin.mjs ntnbhat9@gmail.com` run.

1. `docker compose --profile local up -d --build`; all services healthy. `curl --resolve agent.localhost:443:127.0.0.1 https://agent.localhost/agui -X POST` → 401 (no secret). With the secret and no token → 401 `signed_out`.
2. In Chrome, open `https://app.localhost`. It redirects to `/login`. **Continue with Google** as `ntnbhat9@gmail.com` (the owner does the Google consent). You land on `/`, onboarding starts, and the header shows the Admin link.
3. In a private window, open `/request-access` and submit `Dummy One / ntnbhat9+oab-e2e1@gmail.com / testing`. The thank-you page appears. Submit again; it's identical and no new row is created (check `/admin`).
4. As admin, `/admin` → Requests → Pending shows "Showing 1–1 of 1" → **View** shows the details → **Approve**. Expected: `invite_status='sent'` if the Resend sandbox accepts the plus-address, otherwise `invite_status='failed'` with a visible error. Both outcomes are acceptable; record which one happened.
5. Get the dummy's link without email: `node supabase/scripts/dev-link.mjs ntnbhat9+oab-e2e1@gmail.com`. This dev-only script uses the secret key and `auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: "https://app.localhost/auth/confirm" } })` and prints `https://app.localhost/auth/confirm?token_hash=<hashed_token>&type=email`. Open it in a second Chrome profile, click **Continue**, and you're signed in as the dummy with an empty profile.
6. As the dummy: finish onboarding, open Models → OpenRouter, and paste a test key. The row shows `sk-or-…<last4>`. Network tab: no response contains the key. In SQL (`execute_sql`): `select provider, kind, hint, key_version, octet_length(ciphertext) from provider_credentials` shows the ciphertext only.
7. As the dummy: run a chat ("price eggs and milk at Trader Joe's") that triggers `shop` (writes the workspace cart) and `create_artifact`. Then open the artifact and download the PDF.
8. Make a second dummy (repeat 3–5 with `+oab-e2e2`). As dummy 2:
   - the recent-chats list is empty; Models shows OpenRouter not configured;
   - `fetch('/api/artifacts/<dummy1 artifact id>')` from the console → 404;
   - posting an AG-UI run with dummy 1's `threadId` (copied by hand) → `RUN_ERROR NOT_FOUND`;
   - `GET /api/profile` shows dummy 2's own profile.
9. As admin, **Deactivate** dummy 1. Dummy 1's next action within 30 s shows "Your access has been turned off". Reload → `/login`, and Google or email-link sign-in fails.
10. Try Google sign-in with a non-invited Google account → `/login?error=not_invited`, and no row in `auth.users` (`select count(*) from auth.users`).
11. As admin, **Delete** dummy 1 and dummy 2 (type the email). Storage `artifacts/<id>/` is empty and every table has 0 rows for them.
12. Check the agent logs: `docker compose logs agent | grep -E "sk-|sb_secret|Bearer|refresh"` returns nothing.

The builder records the run as a checklist in the PR description.

## Rollout

1. **Code and migrations on the branch.** Apply migrations 1–6 via MCP `apply_migration`, then `get_advisors`, then run the RLS tests.
2. **Supabase config.** Run `configure-auth.mjs --check`, then `--apply`. Then `--apply --disable-legacy-keys` (nothing uses `anon` / `service_role`; verify the "last used" indicators in the dashboard first). Create a dedicated secret key named `agent` (Settings → API keys) for `.env-agent`.
3. **Bootstrap the admin** (`bootstrap-admin.mjs`), then run the local E2E above.
4. **EC2** (Amazon Linux 2023 or Ubuntu 24.04, t3.large or bigger for Chromium):
   - security group inbound 80/443 from anywhere, 22 from the owner's IP only;
   - IMDSv2 required with hop limit 1 (`aws ec2 modify-instance-metadata-options --http-tokens required --http-put-response-hop-limit 1`);
   - install Docker with the compose plugin; clone the repo at the release commit;
   - DNS A record for `AGENT_HOST` → Elastic IP;
   - create `deploy-config/.env-agent` (with `APP_ORIGIN` = prod web origin), `.env-caddy`, and `.env-search` if used; `chmod 600`;
   - `CADDYFILE=Caddyfile.ec2 docker compose up -d --build`; check `curl https://$AGENT_HOST/agui` → 401;
   - unattended security upgrades on; Docker log rotation (`max-size: 10m`, `max-file: 5`) in `/etc/docker/daemon.json`.
5. **Vercel:** import the repo, set Root Directory `web`, enable files outside root, set the Production env vars above (none for Preview), deploy. Add the production origin to `PROD_ORIGIN` and `SITE_URL` and rerun `configure-auth.mjs --apply`. Set `APP_ORIGIN` on EC2 and restart the agent.
6. **Production smoke test:** steps 2, 6, 7 and 10 of the E2E against the production URLs, with the owner's account plus one dummy, then delete the dummy.
7. **README:** replace "Run" with the local compose + Caddy instructions, the TLS trust step, the env var tables, and the admin bootstrap. Remove the "no login" warning. Add a "Deploy" section for EC2 and Vercel. Update CONTRIBUTING's layout (new `auth/`, `db/`, `crypto/`, `chats/`, `supabase/`).
8. **Commit cadence (owner rules):** a commit after each major step (migrations; agent auth; stores; crypto; web auth; admin; compose/Caddy; docs). Run `npm run build` in both packages before each commit, rebuild and restart containers after each major change, and self-review every diff.

## Claims to verify during build

Each of these is checked by a named test above, not assumed.

1. **Google linking with `disable_signup = true`.** Supabase docs say identities with the same email are linked automatically. They don't explicitly say linking still happens when sign-ups are disabled. Expected yes, since no user is created. Verified by E2E step 2 for the bootstrap admin, and by a dummy whose email is a Google account.
2. **Whether `before-user-created` fires for admin `inviteUserByEmail` / `createUser`.** The docs say it runs "before a new user is created" without listing paths. The design works either way because emails are inserted into `invited_emails` before any admin creation. The integration test records the behavior.
3. **Whether a failed invite email rolls back user creation.** If it doesn't, the user exists and **Resend invite** takes the magic-link path. Both paths are designed. Confirm in E2E step 4.
4. **Resend sandbox and plus-addresses** (`ntnbhat9+x@gmail.com`). Unknown; E2E step 4 records it, and the design doesn't depend on it.
5. **The exact error code on the Google callback for a non-invited account** (`signup_disabled` vs the hook's 403). Map both to `not_invited`; E2E step 10.
6. **`@supabase/ssr` with `cookieOptions.httpOnly: true`.** This is supported when only server clients are used (no browser client). Verify cookie flags in DevTools during E2E.
7. **Units of `sessions_timebox` / `sessions_inactivity_timeout` in the Management API** (the schema says `number`). Check against the dashboard before applying.
8. **Whether pi's `contextNote` hook can be async, and whether pi's OpenAI login can run two flows at once** (port 1455). The design assumes neither.
9. **CopilotKit v2 per-request headers.** The fallback is a runtime per request.

## Open questions for the owner

1. **One Supabase project for local and production?** Today there's one (`dwiuzfvmevdzzabqeaog`). Local test users would then be real users in production, and both environments must share `CREDENTIAL_KEYS`. Recommendation: a second free project for development. The scripts already take `SUPABASE_PROJECT_REF`.
2. **Should invitees share the operator LiteLLM gateway (your keys and your bill), or must they bring their own keys?** The default here is admin-only.
3. **Domains:** the Vercel production domain, and the EC2 agent hostname (needed for Let's Encrypt).
4. **Vercel plan:** chat runs can take minutes; the route's `maxDuration` is capped by the plan. Is the plan Hobby or Pro?
5. **Bot protection on request-access:** is honeypot plus rate limits enough, or do you want Cloudflare Turnstile (a site key in Vercel, a secret in the agent)?

## Left to the builder (builder's calls)

- Exact UI copy, the recent-chats placement, and admin page styling (follow the existing glass style).
- Rate-limit numbers within the table's spirit.
- Per-request CopilotKit runtime vs native header support.
- Global vs local default for sign-out (spec default: local, plus "Sign out everywhere").
- Whether the admin requests list reads via RLS directly (spec default) or via the agent endpoint.
- Persisting widget payloads for reopened chats (not in this version).
- How the signed render timestamp for the request-access form is built.
