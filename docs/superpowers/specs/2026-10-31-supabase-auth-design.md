# Invite-only accounts on Supabase, with every user's data in Supabase

Status: built · 2026-11-01 · branch `feat/supabase-auth` (see "Build notes" at the end for what changed while building)

Review pass (2026-10-31) verified every Supabase claim against the live project (Management API and MCP, read-only), the Supabase docs, the installed packages (`next` 16.4.3, `@copilotkit/runtime` 1.81.0, `@ag-ui/client` 1.0.2, `@earendil-works/pi-*` 1.4.0, `hono` 4.13.14, `playwright` 1.64.1) and the agent and web source. The owner's open questions are now decided (see "Decisions made by the owner"). Nothing in this spec is left to the builder except UI copy and styling.

## Why

Open Agent is single-user today. There is no login, so anyone who reaches port 3000 can read the profile and change keys, and the README tells people to keep it on localhost. Worse, the agent itself is open by default: `app.ts` authorizes every request when no shared secret is configured (`!cfg.sharedSecret || secret === cfg.sharedSecret`, a plain `===`), and `GET /artifacts/:file` has no check at all. Everything a user owns sits on Docker volumes: `profile.json`, `auth.json` (provider OAuth tokens), `local-keys.json` (plaintext API keys), `providers.json`, `workspace.sqlite`, and the artifact HTML/PDF files.

We want to run it for a small invited group: the web app on Vercel and the agent (with SearXNG and Chromium) on an EC2 instance behind Caddy. That needs three things. Only invited people get in. Each person's data is isolated from everyone else's. The EC2 box keeps no user data on disk, so losing or rebuilding the instance loses nothing and a disk snapshot exposes nothing.

The 2026-10-30 onboarding design put the profile behind a `ProfileStore` interface "so a later login only has to attach it to a user". This is that later project, extended to every other store.

## Goals

- Invite-only access. A visitor asks for access, the admin approves, the invitee gets an email link, clicks it and is signed in. After that they sign in with Google, or with an emailed link if their address has no Google account.
- Supabase refuses sign-ups from anyone who wasn't invited. A second check runs inside the database (a `before-user-created` hook), so a dashboard mistake (re-enabling sign-ups) still doesn't let strangers in.
- Every request to the agent carries the user's Supabase access token. The agent checks it against the project's public keys (ES256 via JWKS) and takes the user id only from the token.
- Every piece of per-user state lives in Supabase (Postgres plus Storage), keyed by `user_id`. **The agent is the only reader and writer of user data.** RLS is enabled on every table with no policies for `anon` or `authenticated`, so a leaked publishable key plus a user's access token reads nothing through PostgREST. The web app uses Supabase only for sign-in and session cookies.
- The agent container runs read-only with tmpfs mounts and no volumes.
- Provider keys and OAuth tokens are encrypted by the agent (AES-256-GCM, envelope encryption) before they reach the database. The browser can write a key but never read one back; it only sees a hint like `sk-ant-…a91f`.
- Supabase auth settings and SQL are code: one idempotent configuration script and committed migrations.
- Local development mirrors EC2: everything runs in docker compose behind Caddy with TLS.

## Non-goals

- Teams, sharing chats or artifacts between users, or roles other than admin and user.
- Billing, usage quotas per user (beyond abuse rate limits), or usage dashboards.
- MFA. Supabase supports TOTP (already enabled in the project config) and it can be switched on in the UI later without schema changes.
- Self-service account deletion. The admin deletes accounts (see "Delete a user").
- Moving SearXNG or Chromium off EC2.
- A memory system. Mem0-style memory is still out of scope.
- Cloudflare Turnstile on request-access, a second Supabase project for development, and a verified Resend domain. Each is a documented later step (see "Later steps"), not built now.

## Anti-goals (failures even if it works)

- A key, refresh token, or access token appears in a log line, an error message, a URL, or a browser-readable response.
- The agent trusts a user id from anywhere other than a verified token (a body field, `threadId`, a header the web sets, a header the browser sets that CopilotKit forwards).
- One user can open, continue, or read another user's chat, cart, artifact or provider login by guessing or reusing an id.
- The request-access or email-link form tells a visitor whether an email is already a user or already asked.
- Some code path silently falls back to "no auth" when Supabase is unreachable or a variable is missing. Every auth failure fails closed, with a clear message.
- Data stays on the EC2 disk "temporarily" (a cache file, a SQLite file, a PDF cache).

## Decisions at a glance

| Topic | Decision |
| --- | --- |
| Supabase project | One project, `dwiuzfvmevdzzabqeaog`, for local and production (owner decision 1). Local test users are real users and are deleted after each E2E run. |
| Identity | Supabase Auth: Google OAuth plus email links (invite, magic link). No passwords. |
| Sign-up | `disable_signup = true`, plus a `before-user-created` Postgres hook that only allows emails in `public.invited_emails`. |
| Admin | `app_metadata.role = "admin"` (users can't edit `app_metadata`). Set by `supabase/scripts/bootstrap-admin.mjs`. Admin = `ntnbhat9@gmail.com`. |
| Session in browser | `@supabase/ssr` server clients only, PKCE, cookies `HttpOnly; Secure; SameSite=Lax; Path=/`, host-only. No Supabase client in the browser. |
| Web → agent | Server-to-server only. `Authorization: Bearer <user access token>` plus `x-agent-secret: <AGENT_SERVICE_SECRET>`. The browser never calls the agent. |
| Token verification | `jose` with remote JWKS. Only `ES256`; `iss`, `aud=authenticated`, `exp`, `role=authenticated`, `is_anonymous=false` checked. |
| Data access | Only the agent, with a dedicated secret key (`sb_secret_…`), through `forUser(userId)` repositories. RLS on, no user-role policies, no user-role grants. |
| Key storage | `provider_credentials`, AES-256-GCM per row with a random data key; data key wrapped by a master key from `CREDENTIAL_KEYS`. AAD binds user, provider and kind; the wrap AAD also binds the key version. `KeyWrapper` interface for a later KMS swap. |
| Artifacts | Private Storage bucket `artifacts`, path `{user_id}/{artifact_id}.html|.pdf`, metadata in `public.artifacts`, served only agent → web with the sandbox CSP. |
| Chats | `public.chats` and `public.chat_messages`. The thread id is a client-made UUID; ownership is claimed in the database on the first run. History comes from the database, never from the client. |
| Operator gateway and private-network providers | Admin-only (owner decision 2). |
| Origins | Never hardcoded. `APP_ORIGIN` (web) and `AGENT_HOST` (agent) come from env; locally `https://app.localhost` and `https://agent.localhost` (owner decision 3). |
| Long runs | CopilotKit route `maxDuration = 300` (valid on Hobby and Pro); the agent ends a run cleanly at `RUN_TIME_LIMIT_SECONDS` (default 280) before Vercel cuts the stream (owner decision 4). |
| Bot protection | Honeypot, signed minimum-fill time, DB rate limits (owner decision 5). |
| Email | Supabase custom SMTP via Resend (`smtp.resend.com:465`, user `resend`), sender `onboarding@resend.dev` (sandbox: delivers only to `ntnbhat9@gmail.com`). |
| Hosting | Web on Vercel. Agent, SearXNG and Caddy on EC2. Locally the same compose file adds the web service and a local Caddyfile. |

## Project state today (read 2026-10-31 via Management API and MCP)

- Postgres 17.11, region `us-east-1`. Installed extensions: `pgcrypto`, `uuid-ossp` (schema `extensions`), `supabase_vault`, `pg_stat_statements`, `plpgsql`. `pg_graphql` is **not** installed, so there is no GraphQL surface.
- No tables in `public`, no migrations, no Storage buckets, 0 users.
- `public` already has one function: `public.rls_auto_enable()`, a `SECURITY DEFINER` event-trigger function behind the event trigger `ensure_rls` (`ddl_command_end`). It enables RLS on every new `public` table automatically. Its ACL grants `EXECUTE` to `PUBLIC`, `anon` and `authenticated`, and the security advisor reports it twice (lints 0028 and 0029). Calling an event-trigger function over RPC errors out, but migration 1 revokes it anyway so the advisors are clean.
- Default privileges in `public` (for objects created by `postgres` and `supabase_admin`) grant all table privileges and `EXECUTE` on functions to `anon` and `authenticated`. Every migration must therefore revoke explicitly; migration 1 also changes the `postgres` default privileges.
- `supabase_auth_admin` has `USAGE` on `public`, no `BYPASSRLS`, and no `USAGE` on `storage`.
- Signing keys: ES256 `18b8d44a-322e-4aca-bbbb-064f3f4542b9` is `in_use`; legacy HS256 `4f3b737b-a3ea-468c-ad4f-e10bbe330cfd` is `previously_used`. Legacy `anon` / `service_role` API keys are enabled (`GET …/api-keys/legacy` → `{"enabled":true}`). New-style keys: one `default` publishable and one `default` secret key.
- Auth config: `disable_signup=false`, `external_email_enabled=true`, Google off, no custom SMTP, `site_url=http://localhost:3000`, empty `uri_allow_list`, `jwt_exp=3600`, `refresh_token_rotation_enabled=true`, `security_refresh_token_reuse_interval=10`, `mailer_otp_exp=3600`, `mailer_otp_length=8`, `rate_limit_email_sent=2`, `smtp_max_frequency=60`, `sessions_timebox=0`, `sessions_inactivity_timeout=0`, every hook off, `security_manual_linking_enabled=false`, `mailer_notifications_identity_linked_enabled=false`, TOTP MFA enroll/verify on, default templates.
- The organization's plan can't be read with the owner's token (`GET /v1/organizations/{id}` → 403), so the plan is treated as unknown. Session time-box and inactivity timeout are Pro-only features (Supabase "User sessions" docs).

All of this changes through the script and migrations below, never by hand in the dashboard (exceptions: creating the two secret API keys and the Google Cloud OAuth client).

## Architecture

```
                         Browser (Chrome)
                             │  HTTPS, cookies only for the web origin
                             ▼
   ┌──────────────────────────────────────────────────────────┐
   │ web: Next.js 16 (Vercel; locally the web container behind │
   │      Caddy at https://app.localhost)                     │
   │  proxy.ts ── @supabase/ssr: refresh session (getClaims)  │
   │  /login /request-access /auth/callback /auth/confirm     │──► Supabase Auth only
   │  /admin (admin claim) · /api/* thin proxies · CopilotKit │    (sign-in, refresh,
   │  No database reads: every data call goes to the agent    │     sign-out)
   └───────────────┬──────────────────────────────────────────┘
                   │ HTTPS  Authorization: Bearer <access token>
                   │        x-agent-secret: <AGENT_SERVICE_SECRET>
                   ▼
   ┌─────────────── EC2 (docker compose) ────────────────┐
   │ caddy :443 ── TLS (Let's Encrypt) ── agent:8000      │
   │ agent (read-only fs, tmpfs /tmp and /home/pwuser)    │
   │  auth/: service secret → JWT (JWKS, ES256) → status  │
   │  db/:   user-scoped repos (secret key)               │──────► Supabase
   │  crypto/: envelope AES-256-GCM (CREDENTIAL_KEYS)     │  HTTPS   Auth (JWKS, admin API,
   │  per-user ProviderHub + pi ModelRuntime (in memory)  │           SMTP → Resend)
   │  sessions keyed by user+chat, Chromium pool          │          Postgres (RLS deny-all)
   │ search (SearXNG, internal only)                      │          Storage (artifacts)
   └──────────────────────────────────────────────────────┘
                                                Google OAuth ◄── Supabase redirects
```

Trust boundaries:

1. **Browser ↔ web.** Cookies are scoped to the web origin and HttpOnly. The browser holds no token it can read from JS. Server actions get Next's built-in Origin/Host check; every non-GET route handler checks `Origin === APP_ORIGIN`.
2. **Web ↔ agent.** Server to server over TLS. The service secret proves the caller is our web app. The bearer token proves the user. Both are required. Browser headers are never forwarded (CopilotKit's default header forwarding is turned off, see flow 6).
3. **Agent ↔ Supabase.** The secret key bypasses RLS. That is why the agent only touches data through `forUser(userId)` repositories that put `user_id` into every query, every insert and every Storage path.
4. **Supabase ↔ anyone else.** PostgREST exposes no rows to `anon` or `authenticated` (no grants, no policies). Storage has no policies on `artifacts`. The publishable key is public by design and is only useful for the Auth endpoints.

## Inventory: per-user state today and its new home

| Today | File / place | New home | Browser access |
| --- | --- | --- | --- |
| Profile (home, household, food, travel, shopping, `defaultModel`, notes, skipped, `onboardedAt`) | `/data/agent/profile.json` (`agent/src/profile/store.ts`, `FileProfileStore`) | `public.profiles.data` (jsonb), one row per user | Via agent `GET/PUT /profile` |
| Cloud provider API keys and OAuth logins (ChatGPT) | `/data/agent/auth.json` (pi `ModelRuntime` file store, `authPath`) | `public.provider_credentials` (encrypted), behind a pi `CredentialStore` implementation | None. Hint only, via agent `GET /providers` |
| Local/custom provider API keys, Brave Search key | `/data/agent/local-keys.json` (plaintext, `keys[id]`, `keys["secret:brave-search"]`) | `public.provider_credentials` (`provider` = local provider id, or `secret:brave-search`) | None |
| Provider settings (custom base URLs and models, enabled models, hidden) | `/data/agent/providers.json` | `public.provider_settings.data` (jsonb) | Via agent `GET /providers` |
| OpenAI device id | `/data/agent/device-id` | `public.provider_settings.device_id` | None |
| Workspace (carts, trips, events, shortlists), keyed by thread | `/data/agent/workspace.sqlite` (`node:sqlite`, PK `(thread_id, kind, id)`) | `public.workspace_entities`, PK `(chat_id, kind, entity_id)` | Via agent (AG-UI state, as today) |
| Chats | Not persisted. Threads live in agent memory; history is re-sent by the client and rebuilt with `restoreHistory` (`agui/input.ts`) | `public.chats` and `public.chat_messages` | Via agent `GET /chats`, `GET /chats/:id/messages` |
| Artifacts (HTML, metadata, PDF cache) | `/data/artifacts/{id}.html|.json|.pdf` | Storage `artifacts/{user_id}/{id}.html|.pdf` plus `public.artifacts` | Via agent → web `/api/artifacts/:id` only (sandbox CSP) |
| In-flight provider sign-in flows | `LoginFlows` map (memory, `providers/logins.ts`) | Still memory, each flow bound to `userId` | — |
| Live pi sessions, browser contexts | `SessionStore` (memory, keyed by `threadId`) | Still memory, keyed by `${userId}:${chatId}` | — |
| pi session scratch dir | `mkdtemp(tmpdir(), "pi-session-")` | tmpfs `/tmp` (deleted on dispose, as now) | — |
| Web↔agent secret | `/data/shared/agent-secret` (generated by `lib/secret.ts`) | `AGENT_SERVICE_SECRET` env (not user data) | — |
| SearXNG secret | `searxng-data` volume | Unchanged (not user data) | — |
| Theme | `localStorage.theme` | Unchanged (per device, not sensitive) | — |

Volumes removed from compose: `agent-data`, `artifacts-data`, `shared`. There are no users, so nothing is migrated (owner rule); the old volumes are deleted with `docker volume rm`.

## Data model

All SQL lives in `supabase/migrations/`, applied in order with the Supabase MCP `apply_migration` (name = the part after the timestamp). `apply_migration` records its own version, so each file is named `<recorded version>_<name>.sql` to match `list_migrations`. Migrations are written to run once on an empty schema; they are not re-runnable and don't need to be (`apply_migration` records each one). The owner rules out back-compat, so there are no `if not exists` guards to hide drift.

Conventions:

- Every per-user table has `user_id uuid not null references auth.users(id) on delete cascade`, and an index whose first column is `user_id` (cascade deletes and every agent query filter on it). Every other foreign key also has a covering index (`access_requests.user_id`/`decided_by`, `invited_emails.request_id`/`invited_by`, `chat_messages (chat_id, user_id, id)`, `workspace_entities (chat_id, user_id)`), so the performance advisor reports no unindexed foreign keys.
- Child tables reference their parent with a composite FK `(parent_id, user_id) → parent(id, user_id)`, so the database guarantees a row's `user_id` matches its parent's owner.
- RLS is enabled on every table (the project's `ensure_rls` event trigger also does this; the migrations still say it explicitly). There are **no** policies for `anon` or `authenticated`, and all privileges are revoked from them. The only policy in the schema is the one that lets `supabase_auth_admin` read `invited_emails` for the hook.
- `service_role` (what a secret key maps to) keeps its default grants and bypasses RLS.
- Functions that only the agent calls live in `public` (PostgREST must see them), are `security invoker`, have `set search_path = ''`, and are granted `EXECUTE` to `service_role` only. Trigger and hook functions live in schema `private`, which PostgREST doesn't expose.

### Migration 1: `20261031120000_foundation.sql`

```sql
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create schema private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;

create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function private.touch_updated_at() from public;
```

### Migration 2: `20261031120100_profiles.sql`

```sql
create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null check (email = lower(email) and char_length(email) <= 254),
  data       jsonb not null default '{}'::jsonb
             check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 65536),
  status     text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_idx on public.profiles (email);
create index profiles_created_idx on public.profiles (created_at desc, user_id desc);

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, lower(new.email))
  on conflict (user_id) do nothing;
  return new;
end $$;

create function private.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = lower(new.email) where user_id = new.id;
  return new;
end $$;

revoke execute on function private.handle_new_user() from public;
revoke execute on function private.handle_user_email_change() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
```

`email` is a copy kept in sync by the triggers, so the agent can find a user by email (`profiles_email_idx`, unique) without paging `auth.admin.listUsers`. Every user has an email here because phone sign-in is off and Google requires an email (`external_google_email_optional = false`).

### Migration 3: `20261031120200_access.sql`

```sql
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

alter table public.access_requests enable row level security;
revoke all on public.access_requests from anon, authenticated;

create table public.invited_emails (
  email      text primary key check (email = lower(email) and char_length(email) <= 254),
  request_id uuid references public.access_requests(id) on delete set null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
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
```

- `ip_hash` is `HMAC-SHA256(ACCESS_REQUEST_PEPPER, client_ip)`. Raw IPs are never stored.
- `access_request_submit` does the rate checks and the insert under one transaction-scoped advisory lock, so concurrent submissions can't overshoot the caps. (A PostgREST upsert can't target the partial unique index, which is why this is a function rather than `.upsert({ onConflict })`.) Rate-limited and duplicate outcomes count toward nothing: only inserted rows are counted, which is enough because each insert is one row.
- The hook allows a user only if the email is in `invited_emails`. The agent inserts that row before calling any invite API, and the bootstrap script does the same for the admin. Deleting a user deletes their `invited_emails` row and their `access_requests` rows.
- The hook is `security invoker`, as the Supabase docs recommend; it reads `invited_emails` as `supabase_auth_admin` through the grant and policy above.

### Migration 4: `20261031120300_chats_workspace.sql`

```sql
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
create index chat_messages_chat_idx on public.chat_messages (chat_id, id);
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
```

- `kind` mirrors `ENTITY_KINDS` in `shared/workspace.ts` (`cart`, `trip`, `event`, `shortlist`). A unit test reads the migration file and asserts the two lists match.
- The workspace is per chat today (`thread_id` in the SQLite PK) and stays per chat.
- `workspace_put` runs the optimistic version check in one statement, so two concurrent turns can't both win. SQLSTATE `PT409` makes PostgREST answer HTTP 409, and supabase-js surfaces `error.code === "PT409"` with `error.details` = the current version. The agent maps it to the existing `VersionConflict` (`workspace/conflict.ts`).
- A chat id owned by another user fails the composite FK (`23503`), which the agent maps to `not_found`. On the upsert path (`p_expected is null`) an existing row of another user's chat hits the conflict first, the `where w.user_id = p_user` guard updates nothing, and the function raises `PT409` with detail `0`; the agent maps `PT409` without an expected version to `not_found` (integration test).

### Migration 5: `20261031120400_artifacts.sql`

```sql
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
```

The id regex matches `ARTIFACT_ID_RE` in `shared/artifacts.ts` (`randomBytes(9).toString("base64url")`). There are no `storage.objects` policies for `artifacts`, so only the agent's secret key reads and writes it. This is deliberate: artifact HTML must always be served with `Content-Security-Policy: sandbox …` (`ARTIFACT_CSP`) and `nosniff`, which only our route adds; a signed URL or an RLS read would bypass that. Path ownership is enforced three times: the agent builds the path from the verified user id, the table check constraints, and the metadata lookup by `(id, user_id)`.

On user deletion, `public.artifacts` rows cascade but Storage objects don't. The delete-user flow removes `artifacts/{user_id}/` first.

### Migration 6: `20261031120500_providers.sql`

```sql
create table public.provider_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{"custom":{},"enabled":{},"hidden":[]}'::jsonb
             check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 131072),
  device_id  uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now()
);
create trigger provider_settings_touch before update on public.provider_settings
  for each row execute function private.touch_updated_at();

create table public.provider_credentials (
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null check (provider ~ '^[a-z0-9][a-z0-9:_.-]{0,63}$'),
  kind        text not null check (kind in ('api_key', 'oauth')),
  ciphertext  bytea not null check (octet_length(ciphertext) between 17 and 65536),
  nonce       bytea not null check (octet_length(nonce) = 12),
  dek_wrapped bytea not null check (octet_length(dek_wrapped) = 48),
  dek_nonce   bytea not null check (octet_length(dek_nonce) = 12),
  key_version integer not null check (key_version > 0),
  hint        text not null check (char_length(hint) <= 80),
  version     integer not null default 1 check (version > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, provider)
);
create index provider_credentials_key_version_idx on public.provider_credentials (key_version);
create trigger provider_credentials_touch before update on public.provider_credentials
  for each row execute function private.touch_updated_at();

alter table public.provider_settings enable row level security;
alter table public.provider_credentials enable row level security;
revoke all on public.provider_settings, public.provider_credentials from anon, authenticated;
```

`dek_wrapped` is the 32-byte data key plus a 16-byte GCM tag. `ciphertext` is the encrypted value with its 16-byte tag appended. `version` gives `modify` optimistic concurrency. `bytea` travels through PostgREST as `\x…` hex; the repository encodes and decodes it, and an integration test round-trips it.

### Post-migration checks

After each migration: MCP `list_migrations`, then `get_advisors` for `security` and `performance`. Every finding is fixed except these accepted ones, which are listed in a header comment of migration 6:

- `rls_enabled_no_policy` (INFO) on every `public` table except `invited_emails`: intentional, the agent is the only data path.
- `unused_index` (INFO, performance) on the new indexes: expected on an empty database.
- Nothing else is accepted. The two `rls_auto_enable` warnings are gone after migration 1 (verified 2026-11-01).

## Auth flows

URLs below use the local origin `https://app.localhost`. In production the origin is the Vercel domain. Code always uses `APP_ORIGIN`, never the `Host` header.

Error copy and codes used by the web, in one place (`web/lib/authErrors.ts`):

| Code (`/login?error=`) | Copy |
| --- | --- |
| `not_invited` | "This Google account isn't invited. Use the email you were invited with, or request access." |
| `link_expired` | "That link has expired or was already used. Sign in with Google, or ask for a new link below." |
| `auth_failed` | "Sign-in didn't work. Try again." |
| `signed_out` | "You were signed out. Sign in again." |
| `account_disabled` | "Your access has been turned off." |
| `auth_unavailable` | "Can't reach the account service. Try again in a minute." |

Unknown values show nothing. The raw `error_description` from Supabase is never rendered.

### 1. Request access (visitor)

1. `/request-access` (public, server component) renders name, email, note (optional, up to 1000 characters), a hidden honeypot `company_website` (visually hidden, `tabindex="-1"`, `autocomplete="off"`, `aria-hidden="true"`), and a hidden `form_ts`. `form_ts` is `<unix ms>.<base64url(HMAC-SHA256(key, "<unix ms>"))>` with `key = SHA-256("oab/form-ts/v1\0" + AGENT_SERVICE_SECRET)`, built in `web/lib/formToken.ts` (`signFormTs()` / `checkFormTs(token, now)`).
2. The server action (`web/app/request-access/actions.ts`, `submitAccessRequest`) validates lengths and email shape (400-style inline errors for a malformed field are fine: they reveal nothing about other people). It drops the request silently (same success state, no agent call) if the honeypot is filled, `form_ts` fails the HMAC, or the form is younger than 3 s or older than 1 h.
3. Otherwise web → agent `POST /access-requests` with the service secret (no bearer), body `{ name, email, note }`, header `x-client-ip`. The client IP is the first entry of `x-forwarded-for`, which Vercel overwrites with the real client IP (and which Caddy sets from the TCP peer locally, because Caddy ignores incoming `X-Forwarded-For` from untrusted peers). The agent reads `x-client-ip` on this route and on `POST /auth/email-link` only, and only after the service secret passed.
4. The agent computes `ip_hash` and calls `rpc("access_request_submit", …)`.
5. The response is always `202 { ok: true }`, padded to a 300 ms floor, whatever the outcome. The page shows: "Thanks. If you're approved, you'll get an email from Open Agent." Outcomes other than `inserted` are logged at `info` (`rate_limited_*` at `warn`) with the first 8 hex chars of `ip_hash`, never the email.
6. There is no read-back. The visitor can't see or edit their request.

### 2. Approve and invite (admin)

1. `/admin` (server component) calls `requireAdmin()` (claim check; `notFound()` otherwise) and loads lists from the agent (`GET /admin/access-requests`, `GET /admin/users`). Admin data is never read from Supabase by the web.
2. **Approve** (server action) → agent `POST /admin/access-requests/:id/approve`. The agent runs `requireAdmin` (below), then:
   1. Load the request. Not `pending` → `409 already_decided`.
   2. If `profiles` has that email → set `status='approved'`, `decided_by`, `decided_at`, `user_id`, leave `invite_status` null, and return `409 already_member` ("This email already has an account."). No email.
   3. Upsert `invited_emails (email, request_id, invited_by)` with `ignoreDuplicates`.
   4. `auth.admin.inviteUserByEmail(email, { redirectTo: APP_ORIGIN + "/auth/confirm", data: { name } })`.
   5. Success → `status='approved'`, `invite_status='sent'`, `user_id`, `decided_by`, `decided_at`; `200 { request }`.
   6. Failure → `status='approved'`, `invite_status='failed'`, `invite_error` = the Supabase error `code` plus message, cut to 500 characters; `502 invite_failed` with message "Invite email failed: <code>. Use Resend invite." The row is updated either way.
3. **Resend invite** (`POST …/:id/resend`, request must be `approved`, else `409 not_approved`): if `profiles` has the email, call `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: APP_ORIGIN + "/auth/confirm" } })` on a fresh anon-key client (magic-link template); otherwise repeat `inviteUserByEmail`. Update `invite_status` / `invite_error` the same way. Supabase's `smtp_max_frequency = 60` means a second resend within a minute fails with `over_email_send_rate_limit`; the UI shows that code.
4. **Reject**: `status='rejected'`, `decided_by`, `decided_at`. No email. A later request from the same email is allowed (new row).

The Resend sandbox sender only delivers to `ntnbhat9@gmail.com`. Approving anyone else will most likely take the `invite_status='failed'` path until a domain is verified. That is expected and visible in the UI; the E2E test uses `generateLink` instead.

### 3. First sign-in from the invite link

1. Invite template link: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite`. `RedirectTo` is `APP_ORIGIN/auth/confirm`, exactly as in `uri_allow_list`.
2. `GET /auth/confirm` verifies nothing. It renders one button, "Continue to Open Agent" (`id="auth-confirm-continue"`), inside a form posting to a server action, with `token_hash` and `type` as hidden fields. Email scanners that pre-fetch links therefore can't burn the single-use token.
3. The server action (`web/app/auth/confirm/actions.ts`, `confirmEmailLink`) checks `type ∈ {"invite", "email"}` and `token_hash` matches `^[A-Za-z0-9_-]{10,200}$`, then `supabase.auth.verifyOtp({ type, token_hash })` on the server client. Success sets the session cookies and `redirect("/")`. There is no `next` on this route.
4. The profile row already exists: `private.handle_new_user` created it when the invite created the user. `/` sees an empty profile and starts onboarding, as today.
5. Error → `redirect("/login?error=link_expired")`. The email-link form is on that page.

### 4. Google sign-in

1. `/login` → **Continue with Google** (`id="login-google"`) submits the server action `signInWithGoogle`. It sets a host-only cookie `oab_next` (`HttpOnly; Secure; SameSite=Lax; Path=/auth/callback; Max-Age=600`) to `safeNext(formData.next)`, then calls `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: APP_ORIGIN + "/auth/callback", queryParams: { prompt: "select_account" } } })` on the server client (PKCE: the code verifier is written to a cookie by `setAll`), then `redirect(data.url)`.
   - `next` travels in a cookie, not the `redirectTo` query string, so `uri_allow_list` can hold exact URLs (Supabase matches the allow list as globs against the whole URL, query included).
2. Google → `https://dwiuzfvmevdzzabqeaog.supabase.co/auth/v1/callback` → `APP_ORIGIN/auth/callback?code=…`.
3. `GET /auth/callback` (route handler, `web/app/auth/callback/route.ts`):
   - `error` / `error_code` present: `signup_disabled`, or `error_description` containing "invite-only" (the hook's message) → `/login?error=not_invited`; anything else → `/login?error=auth_failed`.
   - No `code` → `/login?error=auth_failed`.
   - `exchangeCodeForSession(code)`; error → `/login?error=auth_failed`.
   - Read and delete `oab_next`, run it through `safeNext()` again, redirect to `APP_ORIGIN + next`.
4. **Uninvited Google accounts:** with `disable_signup = true`, Supabase won't create a user. If sign-ups were ever re-enabled by mistake, the hook still rejects any email not in `invited_emails`.
5. **Invited user with a Google account on the same email:** Supabase links identities with the same email automatically (Identity Linking docs). Once the invite or magic link has been used, the email is confirmed and Google links to the existing user. If the user tries Google before using the invite, the existing user is unconfirmed; the docs say unconfirmed identities on the existing user are removed on linking, which is harmless here (no password identity). Both orders are in the E2E run (claim 1).
6. `mailer_notifications_identity_linked_enabled = true`, so the user gets an email when Google is linked.

### 5. Email sign-in link (users without Google)

1. `/login` → "Email me a sign-in link" (`id="login-email-submit"`, input `id="login-email-input"`) → server action `requestEmailLink` → agent `POST /auth/email-link` (service secret, no bearer, `x-client-ip`).
2. The agent rate-limits in memory (`email-link-ip:<ip_hash>` 5 per hour, `email-link-addr:<sha256(email)>` 3 per hour). Within limits, it calls `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: APP_ORIGIN + "/auth/confirm" } })` on an anon-key client. It always answers `202 { ok: true }`, padded to 300 ms. Errors (including "Signups not allowed for otp") are logged at `info` with the Supabase error code only.
   - Going through the agent keeps a per-IP limit that works on Vercel (where in-memory state doesn't persist between invocations) and keeps Vercel's shared egress IPs from tripping Supabase's per-IP OTP limit for everyone.
3. The page always says "If that email has access, a link is on its way."
4. Magic-link template: `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`, then the same `/auth/confirm` flow. A `token_hash` link works in a different browser from the one that asked, unlike a PKCE `code` link.

### 6. Every request: session refresh and token forwarding

1. `web/proxy.ts` (Next 16 "proxy", which replaces `middleware.ts`; neither exists today) runs on every path except static assets. It calls `updateSession(request)` from `web/lib/supabase/proxy.ts`: create the server client with request/response cookie adapters, then immediately `supabase.auth.getClaims()`. `getClaims()` verifies the access token against the cached JWKS (ES256 via WebCrypto) and refreshes it with the refresh token when expired, writing new cookies to the request and the response.
2. Route rules in `proxy.ts`:
   - Public: `/login`, `/request-access`, `/auth/callback`, `/auth/confirm`, `/auth/signout`, `/_next/*`, `/favicon.ico`.
   - No valid claims on a page → `302 /login?next=<path>` (the `next` value is passed through `safeNext`). No valid claims on `/api/*` → `401 { error: "signed_out" }`.
   - `/admin` without the admin claim → rewrite to the 404 page. `/api/admin/*` without it → `404 { error: "not_found" }`.
   - Sets the CSP header (below).
3. `getAgentAuth()` (`web/lib/auth.ts`) calls `getClaims()` (verified), then `getSession()` only to read `access_token`; returns `{ userId: claims.sub, accessToken }` or throws `SignedOut` (→ 401).
4. `agentFetch(path, auth, init)` (`web/lib/agentServer.ts`) sets `authorization: Bearer <accessToken>`, `x-agent-secret`, `cache: "no-store"`, `signal: AbortSignal.timeout(30_000)`. It never forwards browser cookies or headers. `forwardToAgent(req, path)` (exists today, rewritten) calls `getAgentAuth()`, rejects non-GET requests whose `Origin` isn't `APP_ORIGIN` with `403 { error: "bad_origin" }`, forwards only `content-type` and the body, and maps an unreachable agent to `502 { error: "agent_unreachable" }`.
5. **CopilotKit / AG-UI** (`web/app/api/copilotkit/[[...slug]]/route.ts`). Today it caches one `CopilotRuntime` with fixed headers, and the installed runtime (1.81.0) forwards browser `authorization` and `x-*` headers to the agent by default (`forwardHeaders` default policy; server headers only win on equal names). The new route:
   - Rejects non-GET requests whose `Origin` isn't `APP_ORIGIN` (403) and requests without a session (`getAgentAuth()` → 401) before touching the runtime.
   - Builds the runtime once, with `agents: async () => { const auth = await getAgentAuth(); return { openagent: new HttpAgent({ url: agentUrl("/agui"), headers: agentHeaders(auth) }) }; }` (the `AgentsFactory` form, `runtime.d.mts` L71–86; the runtime calls it per request and clones the agent) and `forwardHeaders: { useDefaultDenylist: true, denyPrefixes: ["x-"], deny: ["authorization", "cookie"] }`.
   - Passes the runtime a new `Request` built from the original's method, URL and body with only `content-type` and `accept` headers, so nothing the browser sets can reach the agent even if the forwarding policy changes in a CopilotKit update.
   - `export const maxDuration = 300;` and `export const dynamic = "force-dynamic";`.
   - The agent checks the token once at run start. A run that outlives the token's `exp` keeps streaming; it started authorized.
6. **Long runs on Vercel.** With Fluid compute (the default for new projects), Hobby allows `maxDuration` up to 300 s and Pro up to 800 s; a streaming response doesn't extend the limit. `maxDuration = 300` is valid on both. The agent ends every run at `RUN_TIME_LIMIT_SECONDS` (default 280, in `.env-agent`) with `RUN_ERROR` code `TIME_LIMIT` ("This run hit the time limit. Ask me to continue."), after persisting the partial assistant text with `status='interrupted'`. If the client disconnects first (`c.req.raw.signal` aborts), the agent aborts the pi run and persists the same way. On Pro, the owner may raise both (`maxDuration = 800`, `RUN_TIME_LIMIT_SECONDS=780`); the deploy section says how.

### 7. Sign-out

`POST /auth/signout` (`web/app/auth/signout/route.ts`, POST only, `Origin === APP_ORIGIN` or 403) reads form field `scope` (`local` default, or `global`), calls `supabase.auth.signOut({ scope })`, and returns `303 /login`. The header button `id="header-signout"` sends `local`; the profile drawer's "Sign out everywhere" (`id="profile-signout-all"`) sends `global`.

### 8. Deactivate, reactivate, delete

All are admin-only agent endpoints with a confirm dialog in the UI.

- **Deactivate** (`POST /admin/users/:id/deactivate`):
  1. `auth.admin.updateUserById(id, { ban_duration: "876000h" })`. Refresh and new sign-ins fail from then on.
  2. `update profiles set status='deactivated' where user_id = :id`.
  3. Invalidate the agent's status cache entry; dispose the user's live sessions, Chromium contexts and login flows; evict their `ProviderHub`.
  4. Any still-valid access token gets `403 { error: "account_disabled" }` on its next request (status cache TTL 30 s, invalidated immediately on this agent instance; another agent instance, e.g. a local one on the shared project, sees it within 30 s).
  Self → `409 self_action`.
- **Reactivate:** `ban_duration: "none"`, `status='active'`, invalidate cache.
- **Delete** (`DELETE /admin/users/:id`, body `{ confirmEmail }` must equal the user's email, else `422 invalid`). Self → `409 self_action`.
  1. Deactivate (idempotent).
  2. List `artifacts/{id}/` (100 per page) and remove each page; stop and fail on the first error.
  3. `delete from access_requests where email = :email`; `delete from invited_emails where email = :email`.
  4. `auth.admin.deleteUser(id)`. FKs cascade profiles, chats, messages, workspace, artifacts, settings and credentials.
  5. On failure, return `500 { error: "delete_failed", step: "deactivate" | "storage" | "requests" | "auth_user" }`. Every step is idempotent, so retrying is safe.

### 9. Admin bootstrap (one time)

`supabase/scripts/bootstrap-admin.mjs <email> [--user]` runs on the owner's machine with `deploy-config/env-files/.env-supabase-admin` loaded (`SUPABASE_URL`, `SUPABASE_ADMIN_SECRET_KEY`):

1. Upsert `invited_emails (email)` (PostgREST, secret key).
2. Look up `profiles` by email. Missing → `auth.admin.createUser({ email, email_confirm: true, app_metadata: { role: "admin" } })` (`--user`: no `app_metadata.role`). Present → `updateUserById(id, { app_metadata: { ...user.app_metadata, role: "admin" } })` (`--user`: no change).
3. Print the user id and "Sign in with Google at <APP_ORIGIN>/login". No email is sent.

Because the email is created confirmed, the owner's first Google sign-in links to this user. There is no UI to grant admin.

## Agent changes (module by module)

New dependencies: `@supabase/supabase-js` (2.x, pin the exact current version), `jose` (6.x; already in the web tree as a transitive dependency at 6.2.13, not in the agent). No Postgres driver.

### Config: `agent/src/config.ts`

Remove `sharedSecret`, `sharedSecretFile`, `dataDir`, `artifactsDir` (`AGENT_SHARED_SECRET`, `AGENT_SECRET_FILE`, `AGENT_DATA_DIR`, `ARTIFACTS_DIR`). Add:

```
supabaseUrl: string             // SUPABASE_URL, required, must match ^https://[a-z]{20}\.supabase\.co$
supabasePublishableKey: string  // SUPABASE_PUBLISHABLE_KEY, required, starts with "sb_publishable_" (anon client for signInWithOtp)
supabaseSecretKey: string       // SUPABASE_SECRET_KEY, required, starts with "sb_secret_"
serviceSecret: string           // AGENT_SERVICE_SECRET, required, exactly 64 hex chars
credentialKeys: { current: number; keys: Map<number, Buffer> }  // CREDENTIAL_KEYS
appOrigin: string               // APP_ORIGIN, required, https origin, no path or trailing slash
accessRequestPepper: Buffer     // ACCESS_REQUEST_PEPPER, required, base64 of exactly 32 bytes
runTimeLimitSeconds: number     // RUN_TIME_LIMIT_SECONDS, optional, default 280, 30..3600
```

`loadConfig` throws one error listing every missing or invalid variable by name only; the process exits non-zero. Startup also refuses to run if any provider credential variable that pi would read is set in the agent's environment. pi-ai's `resolve.js` falls back to ambient env (`process.env[name]`) whenever a provider has no stored credential, so a stray `OPENAI_API_KEY` would silently serve every user who hasn't added a key. The list is generated from pi's provider catalog (every `provider.auth.apiKey` env name) by `agent/src/auth/ambientEnv.ts` and covered by a test. `LLM_API_KEY` isn't a pi variable (the hub reads it), so it's allowed.

### Auth: `agent/src/auth/`

- `verify.ts`
  ```ts
  export type AuthUser = { id: string; email: string; sessionId: string; isAdmin: boolean };
  export function createVerifier(cfg: Config, opts?: { fetch?: typeof fetch }): (token: string) => Promise<AuthUser>;
  ```
  - `createRemoteJWKSet(new URL(cfg.supabaseUrl + "/auth/v1/.well-known/jwks.json"), { cacheMaxAge: 600_000, cooldownDuration: 30_000, timeoutDuration: 5_000 })`.
  - `jwtVerify(token, jwks, { algorithms: ["ES256"], issuer: cfg.supabaseUrl + "/auth/v1", audience: "authenticated", requiredClaims: ["sub", "exp", "iat", "session_id", "role", "email"], clockTolerance: 30 })`.
  - Then: `role === "authenticated"`, `is_anonymous !== true`, `sub` a UUID, token ≤ 8 KB (checked before parsing), header `typ` absent or `JWT`. `isAdmin` = `app_metadata.role === "admin"`.
  - Errors become `AuthError("invalid_token" | "expired_token")`. Tokens are never logged; at debug, only `kid` and (after verification) `sub`.
- `middleware.ts` (Hono middlewares; handlers read `c.get("user")`, typed through `Hono<{ Variables: { user: AuthUser } }>`):
  - `requireService`: `timingSafeEqual` of SHA-256 digests of `x-agent-secret` and `cfg.serviceSecret`. Applied to every route except `GET /health`. Failure → `401 { error: "unauthorized" }`. There is no "no secret configured" bypass; config validation guarantees the secret exists.
  - `requireUser`: `Authorization: Bearer …`, verify, then `status.isActive(user.id)`. Missing/invalid → `401 { error: "signed_out" }` with `www-authenticate: Bearer error="invalid_token"`. Deactivated or missing profile → `403 { error: "account_disabled" }`.
  - `requireAdmin`: `requireUser`, then `user.isAdmin`, then live `auth.admin.getUserById(user.id)` confirming `app_metadata.role === "admin"` and `banned_until` null or past (cached 30 s per admin). Otherwise `404 { error: "not_found" }`.
- `status.ts`: `UserStatusCache.isActive(userId)` reads `profiles.status` (TTL 30 s for both results); `invalidate(userId)`. DB unreachable → `503 { error: "auth_unavailable" }`. Never assumes active.

`Authorized` (`http/handlers.ts`), `requireSecret`, the inline secret check in `POST /agui`, `lib/secret.ts` and `ensureSharedSecret` are deleted.

### Database access: `agent/src/db/`

- `client.ts`: `createServiceClient(cfg)` → `createClient(cfg.supabaseUrl, cfg.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { "x-client-info": "open-agent-agent" } } })`, and `createAnonClient(cfg)` with the publishable key and the same auth options (used only for `signInWithOtp`). `agent/test/dbImports.test.ts` greps `agent/src` and fails if `db/client` is imported outside `agent/src/db/`.
- `users.ts`: `forUser(db, userId)` returns a frozen object of repositories with `userId` built in:
  - `profiles.get()` → `data`; `profiles.putData(data)` → `update … eq user_id`; 0 rows → `UserError("not_found")` (the trigger always creates the row).
  - `chats.claim(chatId, { model })`: `upsert({ id, user_id, model }, { onConflict: "id", ignoreDuplicates: true })`, then `select id … eq id eq user_id`. No row → `UserError("not_found")` → "This chat doesn't exist."
  - `chats.touch(chatId, { title?, model? })` (also sets `last_message_at = now()`), `chats.page(page)` → `{ items, total }` (5 per page, `last_message_at desc, id desc`, `count: "exact"`), `messages.append(chatId, runId, rows)`, `messages.history(chatId, limit = 200)` (newest 200, returned oldest first, plus `total`).
  - `workspace.get/list/put/remove/summary` (async versions of today's `WorkspaceStore`, `rpc("workspace_put")` for `put`).
  - `artifacts.insert/get/setPdf`, `storage.upload/download/removeAll`. Paths are built here from `userId` and a validated id, never passed in.
  - `providerSettings.get/put` (row created on first `get` with `upsert … ignoreDuplicates`), `credentials.read/list/insert/update/delete`.
- `admin.ts`: `accessRequests.submit/page/get/decide/setInvite/deleteByEmail`, `invited.add/remove`, `users.page/findByEmail/setStatus`. Used only by `http/admin.ts`, `http/accessRequests.ts` and `http/emailLink.ts`.
- `errors.ts`: maps PostgREST/Storage errors to `UserError`: `PT409` → `VersionConflict` (expected vs `details`); `23505` → `conflict`; `23503` → `not_found`; `23514` → `invalid`; network or timeout → `unavailable`; anything else → logged with code only, rethrown as `upstream`. Supabase messages never reach clients.

Every repository call passes `AbortSignal.timeout(10_000)` (`.abortSignal()` on PostgREST builders) and retries once on network errors for reads only.

### Crypto: `agent/src/crypto/`

```ts
export interface KeyWrapper {
  readonly currentVersion: number;
  wrap(dek: Buffer, aad: Buffer): Promise<{ wrapped: Buffer; nonce: Buffer; version: number }>;
  unwrap(wrapped: Buffer, nonce: Buffer, version: number, aad: Buffer): Promise<Buffer>;
}
export class LocalKeyWrapper implements KeyWrapper { /* AES-256-GCM with CREDENTIAL_KEYS */ }

export type CredentialContext = { userId: string; provider: string; kind: "api_key" | "oauth" };
export type Sealed = { ciphertext: Buffer; nonce: Buffer; dekWrapped: Buffer; dekNonce: Buffer; keyVersion: number };
export async function seal(w: KeyWrapper, plaintext: Buffer, ctx: CredentialContext): Promise<Sealed>;
export async function open(w: KeyWrapper, s: Sealed, ctx: CredentialContext): Promise<Buffer>;
export async function rewrap(w: KeyWrapper, s: Sealed, ctx: CredentialContext): Promise<Sealed>;
```

- **AAD.** `valueAad = utf8("oab/credential/v1\0" + userId + "\0" + provider + "\0" + kind)`. `wrapAad(version) = valueAad + utf8("\0dek\0" + version)`. The value AAD deliberately excludes the key version, so rotation (which rewraps only the DEK) never invalidates the value ciphertext; the wrap AAD includes it, so a `key_version` swapped in the row fails the unwrap. Moving a row's bytes to another user, provider or kind fails both.
- **`seal`:** `dek = randomBytes(32)`, `nonce = randomBytes(12)`, AES-256-GCM over the plaintext with `valueAad`, tag appended. `w.wrap(dek, wrapAad(w.currentVersion))` with a fresh random 12-byte nonce. `dek.fill(0)`.
- **`open`:** unwrap with `wrapAad(s.keyVersion)`, decrypt with `valueAad`, zero the DEK. Any failure is `CredentialIntegrityError`: logged once as `[crypto] credential failed integrity check user=<id> provider=<p>` and the provider is treated as not configured (the UI shows "Key unreadable, enter it again").
- **Nonces.** Random 96-bit nonces under a per-row random DEK: each DEK encrypts exactly one value (a new DEK per `seal`), and each master key wraps far fewer than 2^32 DEKs, so the random-nonce collision bound is not a concern.
- **`CREDENTIAL_KEYS` format:** `v2:<base64 32 bytes>,v1:<base64 32 bytes>`. The first entry is current. Each key decodes to exactly 32 bytes; versions are unique positive integers. Generate with `openssl rand -base64 32`.
- **Plaintext lifetime:** decrypted values exist only inside `SupabaseCredentialStore.read/modify` and pi's in-memory auth during a call. Buffers we own are zeroed. `lib/log.ts` gains `redact(value)` that masks `sk-[A-Za-z0-9_-]{8,}`, `sb_secret_\S+`, `sb_publishable_\S+`, `Bearer \S+`, `eyJ[\w-]+\.[\w-]+\.[\w-]+`, and the values of JSON keys `apiKey|key|access|refresh|token|secret|password|authorization`; `log.error/warn` apply it to every argument.
- **Hint** (`crypto/hint.ts`, `hint(value)`): values of 20+ characters → the prefix up to and including the last `-` or `_` within the first 8 characters, then `…`, then the last 4 (`sk-ant-…a91f`, `sk-or-…77c2`); shorter values → `…` plus the last 2. OAuth → `Signed in`, plus ` · <email>` when the credential carries an `email` field. Computed before sealing, stored in clear.
- **Master-key rotation** (`agent/src/scripts/rotateCredentials.ts`, run as `docker compose exec agent node dist/agent/src/scripts/rotateCredentials.js`):
  1. Prepend `v(n+1)` to `CREDENTIAL_KEYS` on every agent (local and EC2 share the project), keep the old keys, restart. New writes use the new key; old rows still open.
  2. Run the script. It pages `provider_credentials where key_version < current` (100 at a time) and `rewrap`s each row (new `dek_wrapped`, `dek_nonce`, `key_version`; value ciphertext untouched), updating with `eq version` and `version = version + 1`. A conflict is re-read and retried once, then reported.
  3. When it reports `0 rows below current`, remove the old key everywhere and restart.
- **KMS later:** `KmsKeyWrapper` maps each `key_version` to a KMS key ARN from config (`KMS_KEYS=v3:arn:aws:kms:…`), wraps with KMS `Encrypt` / `Decrypt` using `EncryptionContext` = the wrap-AAD fields. Nothing else changes.

### Provider credentials and the per-user hub: `agent/src/providers/`

- `credentialStore.ts`: `SupabaseCredentialStore implements CredentialStore` (pi-ai `auth/types.d.ts`: `read(providerId, options?)`, `list(options?)`, `modify(providerId, fn, options?)`, `delete(providerId, options?)`). One instance per user hub.
  - `read`: select the row, `open`, `JSON.parse` into pi's `Credential` (`{ type: "api_key", key } | { type: "oauth", refresh, access, expires, … }`). No row → `undefined`.
  - `list`: `select provider, kind` → `CredentialInfo[]` (`{ providerId, type }`), no decryption.
  - `modify`: serialized per `(userId, provider)` with an in-process async mutex. Read current (row + version), `next = await fn(current)`. `next === undefined` → return current unchanged. Otherwise seal; no row → insert (`23505` = someone else inserted → re-read and rerun `fn` once); row → `update … eq version` setting `version = version + 1` (0 rows → re-read and rerun once). A second failure throws `UserError("conflict")`. pi persists logins and runs OAuth refresh inside `modify` ("the only write path"), so refreshed ChatGPT tokens are written back encrypted.
  - `delete`: delete the row (same mutex).
- `hub.ts`: `ProviderHub.create({ userId, isAdmin, settings, credentials, litellm?, fetch?, complete? })` calls `ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })` instead of `authPath`. `providers.json` → `provider_settings.data`; `local-keys.json` entries → credential rows (`api_key`; provider = local provider id, or `secret:brave-search` for `secret("brave-search")`). `deviceId()` reads `provider_settings.device_id`. `lockAuthFile()`, `save()`'s file writes and all file I/O are deleted. `list()` adds `hint?: string` per configured provider.
- `hubs.ts`: `UserHubs`, an LRU of `ProviderHub` per user (max 200, idle TTL 15 min). `get(user)` builds lazily, sharing the pending build between concurrent callers. Every key, provider or settings mutation calls `invalidate(userId)` after the write commits; live sessions keep their runtime until disposed.
- **LiteLLM operator gateway** (`LLM_API_KEY`, `LLM_BASE_URL`): registered only in hubs where `isAdmin` is true. Invitees bring their own keys (owner decision 2).
- **Local or custom providers** (Ollama, llama.cpp, LM Studio, custom OpenAI-compatible): for non-admins, `addLocal` and every hub build require `publicHttpUrlError(baseUrl) === undefined` and `!(await resolvesInternal(host))` (both exist in `lib/net.ts`); failure → `422 { error: "invalid", message: "That address isn't reachable from the server." }` (and a stored one is skipped at hub build with a warning). Admins may use private, loopback and `host.docker.internal` targets (owner decision 2). EC2 also requires IMDSv2 with hop limit 1.
- `logins.ts`: `LoginFlows.start(userId, providerId)`; `get/answer/cancel(userId, flowId)` return `404 not_found` ("This sign-in expired") for another user's flow. One running flow per user. pi's ChatGPT callback port is hardcoded (`CALLBACK_PORT = 1455` in pi-ai `openai-chatgpt.js`; only the host is configurable via `PI_OAUTH_CALLBACK_HOST`), so only one ChatGPT OAuth flow can run per agent process: a second gets `409 login_busy` ("Another sign-in is in progress. Try again in a minute."). Port 1455 is no longer published, so the browser's redirect to `http://localhost:1455/auth/callback?…` fails on the user's machine; the user copies that URL from the address bar and pastes it into the prompt pi raises (`SignIn.tsx` already renders any `state.prompt` with its message and placeholder). The SignIn copy explains this.

### Profiles: `agent/src/profile/store.ts`

`interface ProfileStore { get(): Promise<Profile>; put(input: unknown): Promise<Profile> }`, obtained with `profiles(userId)`. `SupabaseProfileStore` uses `forUser(db, userId).profiles`: `parseProfile(row.data) ?? emptyProfile()` on read; `parseProfile(input)` then `putData` on write, `UserError("invalid", "that profile isn't valid")` as today. `FileProfileStore` is deleted; `MemoryProfileStore` stays for tests. `withStoredProfile` (`agui/runHandler.ts`) takes the per-user store.

### Chats and sessions: `agent/src/session/`, `agent/src/agui/`, `agent/src/http/chats.ts`

- `POST /agui` gets `requireUser`. `threadId` must be a UUID, else `400 { error: "invalid" }`. Before any work: `chats.claim(threadId, { model })`. Owned by someone else → `RUN_ERROR` code `NOT_FOUND` "This chat doesn't exist."
- `SessionStore` keys by `${userId}:${threadId}` (`getOrCreate(user, threadId, ctx)`). At most 3 live sessions per user (the least recently used idle one is disposed for a fourth) and 50 globally (`RUN_ERROR` code `BUSY`, "The agent is at capacity. Try again shortly.").
- **History:** a new session for an existing chat is seeded from `messages.history(chatId)`. `restoreHistory(input.messages)` is no longer used for seeding; client-sent history is ignored by the model (it still drives the UI).
- **Persistence:** at run start, append the user message (`status='complete'`). At `RUN_FINISHED`, append the final assistant text (without the `<followups>` line) and `chats.touch(threadId, { title: first 80 chars of the first user message when the title is empty })`. On time limit or client abort, append the partial text with `status='interrupted'`. Tool payloads and widgets are not persisted; a reopened chat shows text only.
- `createSession.ts`: `sessionFactory` takes `user` and gets `hub = await hubs.get(user)`. `judgeResolver` is cached per user hub; the global `JEV_CONCURRENCY` limiter stays shared. `braveApiKey` comes from that hub's `secret("brave-search")`. `BrowserPool` contexts are keyed by `${userId}:${threadId}`.
- `contextNote` is this repo's option (`pi/createPiSession.ts`), wired to pi's `context` event, whose handler type allows a Promise (`ExtensionHandler` returns `Promise<R | void> | R | void`). It becomes `contextNote?: () => Promise<string | undefined>` and the handler awaits it.
- `http/chats.ts`: `GET /chats?page=N` → `{ items: [{ id, title, lastMessageAt }], total, page, pageSize: 5 }`; `GET /chats/:id/messages` → `{ items: [{ role, content, status, createdAt }], total }` (newest 200, oldest first). Another user's id → 404.

### Workspace: `agent/src/workspace/`

`WorkspaceStore` becomes an async interface bound to a chat: `forChat(userId, chatId)` → `get(kind, id)`, `list(kind?)`, `put(kind, id, value, expectedVersion?)`, `remove(kind, id)`, `summary()`. `SupabaseWorkspaceStore` implements it through the repositories; `MemoryWorkspaceStore` serves tests. Callers become async: `workspace/cart.ts` (`workspaceCart`, `workspaceNote`), `workspace/edits.ts` (`applyEntityEdits`), `tools/plan.ts`, `tools/index.ts` (`planTool`), `agui/runHandler.ts`, `session/createSession.ts`. `node:sqlite` is removed.

### Artifacts: `agent/src/artifacts/store.ts`, `agent/src/http/artifacts.ts`

- `save(userId, chatId, title, html)`: reject HTML over 5 MB (`413 too_large`). `id = randomBytes(9).toString("base64url")`. Upload to `artifacts/${userId}/${id}.html` with `contentType: "text/html"` (no charset parameter, so it matches `allowed_mime_types` exactly) and `upsert: false`, then insert the row; if the insert fails, remove the object.
- `get(userId, id)`: validate `ARTIFACT_ID_RE`, select `eq id eq user_id`, download `html_path`. Missing → 404, the same for "someone else's".
- `renderPdf(userId, id)`: `pdf_path` set → download. Otherwise render as now (`blockInternalRequests`, `createLimiter(2)`, in-flight `Map` keyed `${userId}:${id}`), upload `…/${id}.pdf` (`contentType: "application/pdf"`), set `pdf_path`.
- `create_artifact` gets `userId` and `chatId` from the session.
- `GET /artifacts/:file` (unauthenticated today) gets `requireService` + `requireUser` and serves with `content-type: text/html; charset=utf-8`, `content-security-policy: ARTIFACT_CSP`, `x-content-type-options: nosniff`, `cache-control: private, no-store`.

### Endpoints

All responses are JSON. Errors are `{ error: <code>, message?: <safe copy>, retryAfter?: <s> }`.

| Method & path | Guard | Body / query | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /health` | none | — | `200 { ok: true }` | — |
| `POST /access-requests` | service | `{ name, email, note }`, `x-client-ip` | `202 { ok: true }` | `400 invalid` (malformed body) |
| `POST /auth/email-link` | service | `{ email }`, `x-client-ip` | `202 { ok: true }` | `400 invalid` |
| `POST /agui` | user | AG-UI `RunAgentInput` | SSE | `400`, `401`, `403`, `429`; in-stream `RUN_ERROR` `NOT_FOUND`/`BUSY`/`TIME_LIMIT` |
| `GET /chats` | user | `page≥1` | `{ items, total, page, pageSize: 5 }` | `400` |
| `GET /chats/:id/messages` | user | — | `{ items, total }` | `404` |
| `GET/PUT /profile`, `GET /settings` (adds `braveSearchHint` when a key is set), `POST /settings/brave-search/key`, `DELETE /settings/brave-search`, `GET /places`, `GET /onboarding/options`, `GET /models`, `GET /providers`, `POST /providers/local`, `POST /providers/test`, `POST /providers/:id/login`, `GET/POST/DELETE /providers/logins/:flow[/answer]`, `POST /providers/:id/key`, `DELETE /providers/:id`, `GET/PUT /providers/:id/models` | user | as today | as today, plus `hint` on providers | as today, plus `401`/`403`/`429` |
| `GET /artifacts/:file` | user | — | HTML or PDF | `404` |
| `GET /admin/access-requests` | admin | `status=pending|approved|rejected|all`, `page≥1` | `{ items, total, page, pageSize: 5 }`, `created_at desc, id desc` | `400` |
| `POST /admin/access-requests/:id/approve` | admin | — | `200 { request }` | `409 already_decided`, `409 already_member`, `502 invite_failed` |
| `POST /admin/access-requests/:id/reject` | admin | — | `200 { request }` | `409 already_decided` |
| `POST /admin/access-requests/:id/resend` | admin | — | `200 { request }` | `409 not_approved`, `502 invite_failed` |
| `GET /admin/users` | admin | `page≥1`, `q` (email prefix, optional, ≤ 254 chars) | `{ items: [{ id, email, status, createdAt, lastSignInAt, providers, isAdmin }], total, page, pageSize: 5 }`, `created_at desc` | `400` |
| `POST /admin/users/:id/deactivate`, `/reactivate` | admin | — | `200 { user }` | `409 self_action`, `404` |
| `DELETE /admin/users/:id` | admin | `{ confirmEmail }` | `200 { ok: true }` | `409 self_action`, `422 invalid`, `500 delete_failed` + `step` |

Status codes: `401 unauthorized` (service secret), `401 signed_out`, `403 account_disabled`, `404 not_found`, `409` as listed and `version_conflict`/`login_busy`/`conflict`, `413 too_large`, `422 invalid`, `429 rate_limited`, `502 invite_failed`/`upstream`, `503 auth_unavailable`/`unavailable`. The agent sends no CORS headers and answers `OPTIONS` with 405.

The users list reads one page of `profiles` (5 rows) and calls `auth.admin.getUserById` for those 5 ids to add `lastSignInAt`, `providers` and `isAdmin`.

### Rate limits: `agent/src/lib/rateLimit.ts`

An in-memory sliding window keyed by string (one agent process per environment; access requests use the DB).

| Key | Limit |
| --- | --- |
| `run:<user>` | 30 runs per 10 min, 2 concurrent |
| `keys:<user>` (key set/delete, local provider add, provider test) | 20 per hour |
| `login:<user>` | 5 per 10 min |
| `profile:<user>` (PUT) | 60 per hour |
| `places:<user>`, `options:<user>` | 120 per 10 min |
| `chats:<user>` | 120 per 10 min |
| `admin:<user>` | 120 per 10 min |
| `email-link-ip:<ip_hash>` / `email-link-addr:<sha256(email)>` | 5 / 3 per hour (silent: still `202`) |
| Access requests | in DB: 3 per hour and 10 per day per `ip_hash`, 200 per day globally (silent) |

Exceeding a user limit → `429 { error: "rate_limited", retryAfter }` plus `Retry-After`. The web shows "Slow down: try again in N s." and never retries automatically.

### Errors and logging

- `safe()` (`http/handlers.ts`) keeps mapping `UserError` (`lib/errors.ts`) to a status. New kinds: `unauthorized` → 401, `forbidden` → 403, `rate_limited` → 429, `too_large` → 413.
- Log lines carry `user=<uuid>` (never email), `thread=`, `run=`. At `LOG_LEVEL=debug`, prompts and the profile are logged as today (the README warns). Tokens, keys, ciphertext and `authorization` headers are never logged, and `redact()` runs in `log.error/warn`.

### Evals

`agent/evals/run.ts` drops `readSecret` (which today reads `/data/shared/agent-secret` from the container). It reads `AGENT_SERVICE_SECRET` and `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` from `deploy-config/.env-agent` and `SUPABASE_ADMIN_SECRET_KEY` from `deploy-config/env-files/.env-supabase-admin`, then mints a token in `agent/evals/auth.ts`: `auth.admin.generateLink({ type: "magiclink", email: EVAL_USER_EMAIL })` with the secret key, then `verifyOtp({ type: "email", token_hash: data.properties.hashed_token })` with the publishable key. `EVAL_USER_EMAIL` defaults to `oab-eval@example.test`; the user is created once with `bootstrap-admin.mjs oab-eval@example.test --user` and needs a provider key added through the app.

## Web changes

New dependencies: `@supabase/ssr` (0.8.x or newer, exact pin), `@supabase/supabase-js` (2.x, exact pin). The web makes no database calls.

| File | Change |
| --- | --- |
| `web/lib/supabase/server.ts` | `createClient()` → `createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll, setAll }, cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/" } })`. `@supabase/ssr` merges `cookieOptions` over its defaults (`httpOnly: false`, `maxAge` 400 days), so `httpOnly: true` takes effect. `setAll` swallows the error thrown in Server Components (proxy refreshes). |
| `web/lib/supabase/proxy.ts` | `updateSession(request)`: the documented pattern with `getClaims()` right after client creation and the same `cookieOptions`; returns `{ response, claims }`. |
| `web/proxy.ts` | `updateSession`, route rules from flow 6, CSP header. `config.matcher` excludes `_next/static`, `_next/image`, `favicon.ico` and image extensions. |
| `web/lib/auth.ts` | `getClaimsOrNull()`, `requireUser()` (redirects to `/login`), `requireAdmin()` (`notFound()`), `getAgentAuth()`, `safeNext(raw)`. |
| `web/lib/agentServer.ts` | Delete `agentSecret()` and the secret-file read. `agentHeaders(auth)` → `{ authorization, "x-agent-secret" }`. `agentFetch` and `forwardToAgent` as in flow 6. `AGENT_SERVICE_SECRET`, `AGENT_URL` and `APP_ORIGIN` are validated on first use and throw a named error if missing; no defaults. |
| `web/lib/formToken.ts`, `web/lib/authErrors.ts` | Flow 1 form token; error copy table. |
| `web/app/api/*/route.ts` (profile, providers, settings, models, places, onboarding/options, artifacts) | Through `forwardToAgent` / `agentFetch` with auth. The artifacts route keeps `ARTIFACT_CSP` and `nosniff` and adds `cache-control: private, no-store`. |
| `web/app/api/chats/route.ts`, `web/app/api/chats/[id]/messages/route.ts` | Proxies to the agent's chat endpoints. |
| `web/app/api/copilotkit/[[...slug]]/route.ts` | Flow 6. |
| `web/app/login/page.tsx` + `actions.ts` | Google button, email-link form, error banner from `authErrors.ts`, link to `/request-access`. A signed-in visitor is redirected to `/`. |
| `web/app/request-access/page.tsx` + `actions.ts` | Flow 1. |
| `web/app/auth/callback/route.ts` | Flow 4. |
| `web/app/auth/confirm/page.tsx` + `actions.ts` | Flow 3. |
| `web/app/auth/signout/route.ts` | Flow 7. |
| `web/app/admin/page.tsx`, `web/app/admin/actions.ts`, `web/components/admin/RequestsList.tsx`, `UsersList.tsx`, `ConfirmDialog.tsx` | Tabs **Requests** (filter Pending, Approved, Rejected, All) and **Users**. 5 rows per page, newest first, "Showing 1–5 of 16", Previous/Next. Each row has **View** (expands name, email, note, IP-hash prefix, dates, invite status and error) and actions (Approve / Reject / Resend; Deactivate / Reactivate / Delete). Destructive actions open a confirm dialog; Delete requires typing the email. Errors render inline on the row (`role="alert"`) with the agent's message; a failed action never looks successful. Empty states: "No pending requests.", "No users yet." A list that fails to load shows "Couldn't load requests: <message>" with a Retry button. |
| `web/components/chat/RecentChats.tsx` | In the profile drawer, under a "Recent chats" heading: 5 per page, newest first, "Showing 1–5 of 16", Previous/Next, each row with **View** (title, date) and **Open**. Open sets `threadId` and loads the messages (text only, interrupted ones marked "(stopped)"). |
| `web/components/profile/models/ProviderRow.tsx`, `ProviderForms.tsx`, `SearchSettings.tsx`, `SignIn.tsx` | Show `hint` instead of only "configured". Key inputs are `type="password"`, `autoComplete="off"`, cleared after save; no "show key". SignIn explains the paste-the-redirect step. |
| `web/components/Chat.tsx` | Header (`chat-header`) gets the user's email (`header-email`), sign-out (`header-signout`) and, for admins, an Admin link (`header-admin-link`). Any `401 signed_out` → banner with a sign-in link; `403 account_disabled` → full-page "Your access has been turned off." |
| `web/next.config.ts` | `headers()` for all routes: `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `X-Frame-Options: DENY` except `/api/artifacts/*` (its CSP sets `frame-ancestors 'self'`). No `preload` (the Vercel domain may be a shared `vercel.app` subdomain). |
| CSP (in `proxy.ts`) | Per-request nonce: `default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self' https://accounts.google.com <NEXT_PUBLIC_SUPABASE_URL>; base-uri 'none'; object-src 'none'`; `'unsafe-eval'` added only when `NODE_ENV=development`. The theme script in `layout.tsx` (today `dangerouslySetInnerHTML`) reads the nonce from `headers()` and sets it. `form-action` includes Supabase and Google because Chrome applies it to the redirect chain after the Google button's form post. |

Every new element gets a unique `id` (project rule) with prefixes `login-`, `request-access-`, `auth-confirm-`, `admin-requests-`, `admin-users-`, `recent-chats-`, `header-`, `profile-signout-`. Row ids include the record id (`admin-requests-row-<uuid>`, `admin-requests-approve-<uuid>`, `recent-chats-open-<uuid>`).

`docker-compose.yml`'s `shared` mount and the `agentsecret` group in `web/Dockerfile` are removed.

**Vercel monorepo note:** the project's Root Directory is `web` with "Include files outside the root directory" enabled, because `web` imports `@shared/*` and `next.config.ts` sets `outputFileTracingRoot` to the repo root (it does today).

## Supabase configuration script

`supabase/scripts/configure-auth.mjs`: Node 22, no dependencies, idempotent.

```
set -a; . deploy-config/env-files/.env-supabase-admin; set +a
node supabase/scripts/configure-auth.mjs --check     # masked diff, exit 1 on drift
node supabase/scripts/configure-auth.mjs --apply     # PATCH only changed fields, then re-check
```

1. `GET https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth` with `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`.
2. Diff against the desired object below field by field. Secrets (`smtp_pass`, `external_google_secret`) come back `null` when unset; they are sent when the current value is null or `--rotate-secrets` is passed, and printed as `<set>`, never the value.
3. `PATCH /v1/projects/{ref}/config/auth` with the differing fields. If the PATCH is rejected only because of `sessions_timebox` / `sessions_inactivity_timeout` (plan restriction), the script retries without them and prints `sessions_*: skipped, requires Pro plan` (exit 0). Any other failure exits 1 with the API's message.
4. Signing keys: `GET …/config/auth/signing-keys` must show exactly one `in_use` key with `algorithm: "ES256"`; otherwise exit 1. It never rotates.
5. Legacy API keys: `GET …/api-keys/legacy`. With `--disable-legacy-keys`: `PUT …/api-keys/legacy?enabled=false`, then `PATCH …/config/auth/signing-keys/{id of the HS256 key}` with `{ "status": "revoked" }`. Separate flag because it's hard to undo; done in rollout step 2 before anything uses the legacy keys (nothing does).
6. Before enabling the hook, `POST …/database/query/read-only` with `select to_regprocedure('private.before_user_created(jsonb)') is not null as ok`; refuse if false, because a missing hook function breaks every user-creation path.

Desired auth config (field names and types checked against the live GET and the Management API OpenAPI `UpdateAuthConfigBody`):

| Field | Value | Note |
| --- | --- | --- |
| `site_url` | `$SITE_URL` | Prod origin once known; `https://app.localhost` until then |
| `uri_allow_list` | `https://app.localhost/auth/callback,https://app.localhost/auth/confirm` plus `$PROD_ORIGIN/auth/callback,$PROD_ORIGIN/auth/confirm` when `PROD_ORIGIN` is set | Exact URLs (no query strings are used); previews excluded |
| `disable_signup` | `true` | |
| `external_email_enabled` | `true` | Invite and magic link |
| `mailer_autoconfirm` | `false` | |
| `mailer_allow_unverified_email_sign_ins` | `false` | Already false |
| `external_anonymous_users_enabled` | `false` | Already false |
| `external_phone_enabled` | `false` | Already false |
| `external_google_enabled` | `true` | |
| `external_google_client_id` | `$GOOGLE_CLIENT_ID` | |
| `external_google_secret` | `$GOOGLE_CLIENT_SECRET` | Secret |
| `external_google_email_optional` | `false` | |
| `security_manual_linking_enabled` | `false` | |
| `mailer_notifications_identity_linked_enabled` | `true` | |
| `mailer_notifications_identity_unlinked_enabled` | `true` | |
| `jwt_exp` | `900` | Seconds (max 604800). Bounds token life after deactivation; the agent's 30 s status check is the tighter guard |
| `refresh_token_rotation_enabled` | `true` | Already true |
| `security_refresh_token_reuse_interval` | `10` | Seconds; already 10 |
| `sessions_timebox` | `720` | **Hours** (30 days). Pro-only; skipped with a message on lower plans |
| `sessions_inactivity_timeout` | `168` | **Hours** (7 days). Pro-only; same |
| `mailer_otp_exp` | `3600` | Seconds; invite and magic links last 1 h |
| `rate_limit_email_sent` | `30` | Per hour; only editable with custom SMTP |
| `smtp_host` | `smtp.resend.com` | |
| `smtp_port` | `"465"` | String in the API |
| `smtp_user` | `resend` | |
| `smtp_pass` | `$RESEND_API_KEY` | Secret, sending-only key |
| `smtp_admin_email` | `$SMTP_SENDER_EMAIL` | `onboarding@resend.dev` |
| `smtp_sender_name` | `Open Agent` | |
| `smtp_max_frequency` | `60` | Seconds between emails to one address; already 60 |
| `mailer_subjects_invite` | `You're invited to Open Agent` | |
| `mailer_templates_invite_content` | `supabase/templates/invite.html` | |
| `mailer_subjects_magic_link` | `Your Open Agent sign-in link` | |
| `mailer_templates_magic_link_content` | `supabase/templates/magic_link.html` | |
| `hook_before_user_created_enabled` | `true` | |
| `hook_before_user_created_uri` | `pg-functions://postgres/private/before_user_created` | Needs migration 3 (step 6 checks) |
| `security_captcha_enabled` | `false` | Turnstile is a later step |
| `password_min_length` | `12` | Defense in depth; no flow sets a password |

**Templates** (`supabase/templates/*.html`): short plain HTML, inline styles, no images, no tracking. Invite:

```html
<h2>You're invited to Open Agent</h2>
<p>Hi{{ if .Data.name }} {{ .Data.name }}{{ end }}, your request was approved. This link signs you in and expires in one hour.</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Accept the invite</a></p>
<p>After this, sign in with Google using this email ({{ .Email }}), or ask for an email link on the sign-in page.</p>
<p>If you didn't ask for access, ignore this email.</p>
```

Magic link: the same structure, heading "Sign in to Open Agent", link `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email`.

**Google Cloud console** (owner, by hand): OAuth client type "Web application", authorized redirect URI `https://dwiuzfvmevdzzabqeaog.supabase.co/auth/v1/callback`, consent screen published (or the owner's and testers' accounts added as test users while in testing mode). The client id and secret are already in `.env-supabase-admin`.

**Secret API keys**: `agent` (for `.env-agent`) and `admin_scripts` (for `.env-supabase-admin`), created with `POST /v1/projects/{ref}/api-keys?reveal=true` (`{"type":"secret","name":…,"secret_jwt_template":{"role":"service_role"}}`) by a script that writes the returned value straight into the env file without printing it. Each can be revoked alone. The `default` secret key is then deleted (`DELETE …/api-keys/{id}`; still pending, see Build notes).

Migrations are applied with MCP `apply_migration`; the script doesn't run DDL.

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
      max_size 4MB
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
        read_timeout 20m
        write_timeout 20m
      }
    }
  }

  app.localhost {
    encode zstd gzip
    reverse_proxy web:3000 {
      flush_interval -1
    }
  }

  agent.localhost {
    import agent_common
  }
  ```
- `deploy-config/caddy/Caddyfile.ec2`: global options `{ admin off; email {$ACME_EMAIL} }`, the same `(agent_common)` snippet, and one site `{$AGENT_HOST} { import agent_common }`. No `app` site (web is on Vercel).
- `flush_interval -1` keeps AG-UI SSE unbuffered on both hops. 4 MB covers AG-UI run bodies (the client still sends its message list); a larger body gets Caddy's 413.

### `docker-compose.yml`

- New `caddy` service: image `caddy:2.10` pinned by digest; ports `127.0.0.1:80:80` and `127.0.0.1:443:443` by default, overridden on EC2 with `CADDY_BIND=0.0.0.0` (`"${CADDY_BIND:-127.0.0.1}:443:443"`); volumes `./deploy-config/caddy/${CADDYFILE:-Caddyfile.local}:/etc/caddy/Caddyfile:ro`, `caddy-data:/data`, `caddy-config:/config`; `env_file: [{ path: deploy-config/.env-caddy, required: false }]` (`AGENT_HOST`, `ACME_EMAIL`, not secret); `depends_on: agent (service_healthy)`.
- `agent`: drop the `agent-data`, `artifacts-data` and `shared` volumes and the `127.0.0.1:1455:1455` port. Keep `PI_OAUTH_CALLBACK_HOST: 0.0.0.0`. Add `read_only: true`, `tmpfs: ["/tmp:size=512m,mode=1777", "/home/pwuser:size=128m,uid=<pwuser uid>,gid=<pwuser gid>,mode=0700"]` (uid/gid per claim 10; pi scratch, Chromium profile and crash dirs; the Playwright browsers live in the image under `/ms-playwright` and stay read-only), `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`. Playwright launches Chromium with `--no-sandbox` by default (`chromiumSandbox: false`), so no capabilities are needed. Keep `127.0.0.1:8000:8000` for local debugging (loopback only, harmless on EC2). `env_file: [{ path: deploy-config/.env-agent, required: true }]`.
- `web`: `profiles: ["local"]`; `env_file: [{ path: deploy-config/.env-nextjs, required: true }]`; drop the `shared` volume and the `3000` port (the browser reaches web only through Caddy); `AGENT_URL: http://agent:8000`.
- `search`: drop the published port (only the agent uses it, over the compose network).
- `llm` and `ollama` profiles stay as they are (admin-only use).
- Volumes: remove `agent-data`, `artifacts-data`, `shared`; add `caddy-data`, `caddy-config`.
- `agent/Dockerfile`: remove the `agentsecret` group and the `/data/*` dirs. `web/Dockerfile`: remove the group.

Local: `docker compose --env-file deploy-config/.env-nextjs --profile local up -d --build`. The `--env-file` feeds the web image's `NEXT_PUBLIC_SUPABASE_*` build args (`build.args` in compose; `env_file` doesn't reach builds, and Next inlines whatever value is present at build time, even an empty string, so `web/Dockerfile` fails the build when they are empty). EC2: `CADDYFILE=Caddyfile.ec2 CADDY_BIND=0.0.0.0 docker compose up -d --build`. The web healthcheck fetches `/login` (`/` redirects to `APP_ORIGIN`, which the container can't resolve).

Locally the web container calls the agent at `http://agent:8000` (compose network), while Vercel calls `https://$AGENT_HOST` through Caddy. The Caddy agent path is exercised locally by the E2E `curl` checks.

**Local TLS trust (one time):** `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt`. Chrome resolves `*.localhost` to 127.0.0.1 without `/etc/hosts`. For `curl`, use `--resolve app.localhost:443:127.0.0.1 --cacert /tmp/caddy-root.crt`.

### Cookies and CORS

- Auth cookies live only on the web origin, host-only, `HttpOnly; Secure; SameSite=Lax; Path=/`. `oab_next` is `Path=/auth/callback`, 10 minutes. The agent domain never sees a browser cookie.
- The agent sends no CORS headers and answers `OPTIONS` with 405.

## Environment variables

`S` = secret (never committed, never `NEXT_PUBLIC_`, never logged). All files below are git-ignored (`deploy-config/.env*`, `deploy-config/**/.env*`); example files with names only live in `deploy-config/env.examples/` (`agent.env.example`, `nextjs.env.example`, `caddy.env.example`, `supabase-admin.env.example`), a folder name the ignore rules don't match.

### Agent: `deploy-config/.env-agent` (local and EC2)

| Variable | S | Example / format |
| --- | --- | --- |
| `SUPABASE_URL` | | `https://dwiuzfvmevdzzabqeaog.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | S | `sb_secret_…` (the `agent` key) |
| `AGENT_SERVICE_SECRET` | S | 64 hex chars (`openssl rand -hex 32`); same value in web |
| `CREDENTIAL_KEYS` | S | `v1:<base64 32 bytes>`; **identical** on local and EC2 (one shared project) |
| `ACCESS_REQUEST_PEPPER` | S | base64 32 bytes; identical on local and EC2 |
| `APP_ORIGIN` | | `https://app.localhost` locally; `https://<APP_HOST>` on EC2 |
| `RUN_TIME_LIMIT_SECONDS` | | optional, default `280` |
| `LOG_LEVEL`, `JEV_MODEL`, `JEV_CONCURRENCY`, `AGENT_MODEL_CAPS`, `AGENT_MODELS` | | unchanged |
| `LLM_API_KEY` | S | optional, admin-only gateway |
| `LLM_BASE_URL` | | optional |

Removed: `AGENT_SHARED_SECRET`, `AGENT_SECRET_FILE`, `AGENT_DATA_DIR`, `ARTIFACTS_DIR`. Any pi provider key variable (`OPENAI_API_KEY`, …) makes startup fail.

Sharing `CREDENTIAL_KEYS` means the owner's laptop holds the production master key. That is accepted while there is one project (owner decision 1); the second-project later step removes it.

### Web, local: `deploy-config/.env-nextjs`

| Variable | S | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | | `https://dwiuzfvmevdzzabqeaog.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | | `sb_publishable_…` (public by design) |
| `APP_ORIGIN` | | `https://app.localhost` |
| `AGENT_SERVICE_SECRET` | S | same as agent |

`AGENT_URL` is set by compose (`http://agent:8000`).

### Vercel (Production only; Preview gets none, so previews can't sign in or reach the agent)

| Variable | S | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | | as above |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | | as above |
| `APP_ORIGIN` | | `https://<APP_HOST>` |
| `AGENT_URL` | | `https://<AGENT_HOST>` |
| `AGENT_SERVICE_SECRET` | S | marked Sensitive |

### Supabase admin scripts: `deploy-config/env-files/.env-supabase-admin` (owner's machine only)

Today the file holds `SUPABASE_ACCESS_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`. Add the rest:

| Variable | S | Note |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | S | Management API personal token (exists) |
| `SUPABASE_PROJECT_REF` | | `dwiuzfvmevdzzabqeaog` (add) |
| `SUPABASE_URL` | | `https://dwiuzfvmevdzzabqeaog.supabase.co` (add) |
| `SUPABASE_PUBLISHABLE_KEY` | | (add; used by test and link scripts for `verifyOtp`) |
| `SUPABASE_ADMIN_SECRET_KEY` | S | the `admin_scripts` secret key (add) |
| `GOOGLE_CLIENT_ID` | | (exists) |
| `GOOGLE_CLIENT_SECRET` | S | (exists) |
| `RESEND_API_KEY` | S | (exists), sending-only |
| `SMTP_SENDER_EMAIL` | | `onboarding@resend.dev` (add) |
| `SITE_URL` | | `https://app.localhost` until production exists (add) |
| `PROD_ORIGIN` | | empty until production exists; the script omits it (add) |
| `APP_ORIGIN` | | `https://app.localhost` (add; used by `dev-link.mjs` and printed by bootstrap) |
| `E2E_OPENROUTER_KEY` | S | optional; an OpenRouter key for E2E step 7, pasted into the app by hand |

### Caddy: `deploy-config/.env-caddy` (EC2)

`AGENT_HOST`, `ACME_EMAIL` (not secret).

## Security model and threats

Principles: the user id comes only from a verified token; the service secret plus the token are both required; deny by default (RLS, grants, Storage, CORS, header forwarding); fail closed; secrets stay server-side; least privilege for every key.

| Threat | Mitigation |
| --- | --- |
| Uninvited sign-up via Google or OTP | `disable_signup`, the `before-user-created` allowlist hook, `shouldCreateUser: false`. Tested with a non-invited Google account (E2E) and by integration tests. |
| Admin privilege escalation | Role in `app_metadata` (service role only). Agent admin endpoints re-check live with `getUserById`. No UI grants admin. No admin data path through PostgREST. |
| Forged or confused JWT (`alg: none`, HS256 with the public key, RS/ES swap, another project's token) | `algorithms: ["ES256"]`; key only from this project's JWKS; exact `iss`; `aud`; `role`. `configure-auth.mjs --check` fails while the HS256 key isn't revoked, legacy keys are on, or a secret key other than `agent`/`admin_scripts` exists; `--apply --disable-legacy-keys` fixes all three. Nothing in the repo uses the legacy keys. Unit test per case. |
| Stolen access token used against the agent | Needs the service secret too (not in the browser). Tokens last 15 min. No CORS. |
| Stolen access token turned into a lasting credential by setting a password | The app has no password sign-in: the `private.custom_access_token` hook refuses every token whose `authentication_method` or `amr` is `password`, and the agent verifier refuses `amr` password too. `security_update_password_require_reauthentication` and `..._require_current_password` are on (GoTrue still lets a session younger than 24 h set a password, which is why the hook exists). MFA enrolment is off. HIBP is on where the plan allows. Integration test: a user token sets a password and the password sign-in is refused. |
| Browser-set headers reaching the agent through CopilotKit | Route rebuilds the request with only `content-type`/`accept`; `forwardHeaders` denies `x-*`, `authorization`, `cookie`; the agent reads `x-client-ip` only on the two service-only routes. Unit test posts a request with `authorization`, `x-agent-secret`, `x-client-ip` set by the "browser" and asserts the agent receives only server values. |
| IDOR on chats, artifacts, workspace, login flows | Ownership claimed in the DB (`chats.claim`); every repository query has `eq user_id`; composite FKs; sessions keyed by user+chat; login flows bound to the user; 404 for "not yours". Integration and E2E tests. |
| Direct PostgREST access with the publishable key | No grants and no policies for `anon`/`authenticated`; RLS tests prove every table and RPC is denied. |
| Secret key misuse in agent code | One `db/client.ts`, import-lint test, repositories require `userId` at construction. |
| Key exfiltration from DB or backups | Envelope AES-256-GCM; master key only in agent env; AAD binds the row. |
| Key leakage to browser or logs | No endpoint returns keys; hints only; `redact()`; unit test logs an error with a fake key and asserts it's masked; E2E greps logs. |
| Ambient server credentials serving all users | Startup refuses pi provider env vars; LiteLLM gateway admin-only. |
| CSRF | SameSite=Lax; Next server actions' built-in Origin check; `Origin === APP_ORIGIN` on every non-GET route handler (API proxies, CopilotKit, sign-out). |
| Open redirect via `next` | `safeNext(raw)`: starts with a single `/`, not `//` or `/\`, no control chars or `%2f`/`%5c` after decoding, ≤ 512 chars, `new URL(raw, APP_ORIGIN).origin === APP_ORIGIN`, path in the allowlist (`/`, `/admin`). Otherwise `/`. Redirects are built from `APP_ORIGIN`. `next` never goes to Supabase. Unit tests: `//evil.com`, `/\evil.com`, `https://evil.com`, `/%2F%2Fevil.com`, `/%5Cevil.com`, `javascript:alert(1)`, `/admin`, `/`. |
| Magic-link prefetch by email scanners | `/auth/confirm` needs a button click (POST) before `verifyOtp`. |
| Login CSRF via a crafted `/auth/confirm` link | Links carry `&email=`; the confirm page shows "Sign in as <email>" (or "Accept the invite for") before the button; after `verifyOtp` the action compares the session email with the shown one and signs out on a mismatch (`link_mismatch`). Links asked for on the login page set an HttpOnly `oab_link` cookie (HMAC of the email, path `/auth/confirm`, 1 h); without it the page warns that the link wasn't requested from this browser. Invites and admin-sent links work without the cookie. |
| Token leakage in URLs | Only one-time `token_hash` / `code` appear in URLs and are consumed immediately. `Referrer-Policy: strict-origin-when-cross-origin`. |
| Enumeration via request-access or email link | Both routes validate the body, take the in-memory limits and answer `202` at once; the outcome-dependent work (`access_request_submit`, `signInWithOtp`) runs in a bounded background queue (200 waiting, 2 at a time) whose failures are logged without the address. No read-back. |
| Request-access / email-link spam | Honeypot, signed minimum fill time, single-use form tokens (the agent remembers each for an hour), DB caps per IP hash (10/day, below the 200/day global cap so one address can't exhaust it) and global, unique pending per email. Email links: 5 per IP an hour and 3 per (address, IP), so nobody can lock another person out; Supabase's per-address `smtp_max_frequency` paces mail. IPv6 clients are keyed by their /64. Captcha is a later step. |
| SSRF via custom provider base URLs | Public-only for non-admins. Every user-supplied fetch (adding a server, the model runtime's own calls for custom providers, page and image fetches) goes through one guarded transport: an undici `Agent` whose `connect.lookup` refuses private/reserved answers and pins the checked address (no DNS rebinding), with `redirect: "manual"` and a re-check on every hop (credentials dropped cross-origin, 303 → GET). Blocked ranges use `net.BlockList`: RFC 1918, loopback, link-local, CGNAT 100.64/10, 198.18/15, TEST-NETs, 6to4 relay, multicast, 240/4, broadcast; IPv6 `::/96`, IPv4-mapped, NAT64 `64:ff9b::/96` and `/48`, `100::/64`, `2001::/23`, documentation, `2002::/16`, ULA, link- and site-local, multicast. IMDSv2 hop limit 1. |
| Long-lived session after deactivation | Ban (no refresh, no new sign-in), status check on every agent request (≤ 30 s), `jwt_exp = 900`. |
| Long-lived refresh tokens | Pro plan: time-box 30 days, inactivity 7 days. Lower plans: sessions last until sign-out; "Sign out everywhere" and deactivation end them. Documented. |
| XSS in the web app | Nonce CSP with `strict-dynamic`; React escaping; artifacts only in a sandboxed iframe (no `allow-same-origin`). |
| Exfiltration from an artifact | `ARTIFACT_CSP`: `default-src 'none'`, inline script and style only, fonts only from Google Fonts, `img-src data:` (report pictures are fetched through the guarded transport and inlined, 500 kB each, 1.5 MB per report), `connect-src`/`frame-src`/`form-action`/`base-uri` `'none'`. The app's `frame-src 'self'` stops the frame navigating itself elsewhere. `allow-popups-to-escape-sandbox` stays so links open sites normally (a sandboxed tab breaks most sites); a popup needs a click. |
| Clickjacking | `frame-ancestors 'none'` (artifacts `'self'`), `X-Frame-Options: DENY`. |
| Cookie theft | HttpOnly, Secure, SameSite=Lax, host-only; HSTS on both origins. |
| Agent exposed on EC2 | Only Caddy is public (80/443); SSH from the owner's IP only; read-only containers (agent, web, caddy), all caps dropped (caddy keeps `NET_BIND_SERVICE`), `no-new-privileges`; body limits: Caddy 4 MB, agent 1 MB (4 MB on `/agui`), web forwards at most 1 MB. |
| Supabase outage | `503 auth_unavailable` / `unavailable`; web shows "Can't reach the account service. Try again in a minute." No unauthenticated fallback. |
| Cross-user ChatGPT OAuth paste | Flows bound to the user; one ChatGPT flow per process; pi's PKCE state is tied to the flow. |
| Vercel previews | No env vars in Preview; not in `uri_allow_list`. |

## Testing

### Unit (vitest, no network)

- **Agent `crypto/`:** seal/open round trip; tampering with each of ciphertext, nonce, dek_wrapped, dek_nonce, key_version fails; moving a sealed row to another `userId`, `provider` or `kind` fails; `rewrap` under a new key version opens with the same plaintext and the old version no longer appears; `CREDENTIAL_KEYS` parsing rejects 31/33-byte keys, duplicate versions, `v0`; `hint()` cases.
- **Agent `auth/verify`:** a local ES256 keypair served by an injected `fetch` JWKS. Valid passes. Rejected: `alg: none`, HS256 signed with the public key bytes, RS256, wrong `iss`, wrong `aud`, `role: anon`, `is_anonymous: true`, expired beyond tolerance, missing `session_id`, unknown `kid` (one refetch, then fail), 9 KB token.
- **Agent middleware:** missing or wrong `x-agent-secret` → 401 before any token parsing; deactivated → 403; status DB down → 503; admin endpoint as non-admin → 404.
- **Agent with `Memory*` stores:** session keying (`userA:t1` vs `userB:t1`), login-flow ownership and the global ChatGPT lock, rate-limiter windows, `safe()` mappings, startup refusal on ambient provider env vars, the `db/client` import lint, `ENTITY_KINDS` vs the migration's check list, `RUN_TIME_LIMIT_SECONDS` ends a fake run with `TIME_LIMIT` and an interrupted message.
- **Web:** `safeNext` cases; `checkFormTs` (valid, forged, < 3 s, > 1 h); login error mapping; `forwardToAgent` Origin check and header set (no cookie or browser header forwarding); the CopilotKit route strips browser headers; admin and recent-chats pagination text ("Showing 6–10 of 16"); every new component renders unique ids (extend `web/test/chat/components.test.tsx` and `web/test/profile/components.test.tsx`, which already check id uniqueness).

### Integration against Supabase (`agent/test/supabase/*.int.test.ts`, run with `SUPABASE_INTEGRATION=1`)

They run against the real project with `.env-supabase-admin` loaded and throwaway users `oab-test+<uuid>@example.test`. Each test inserts the email into `invited_emails`, creates the user with `auth.admin.createUser({ email, email_confirm: true })` (no email is sent), and gets a session with `generateLink({ type: "magiclink" })` + `verifyOtp({ type: "email", token_hash })`. `afterAll` deletes every user it created through the same code as the delete-user flow, and a final check asserts `select count(*) from auth.users where email like 'oab-test+%@example.test'` is 0.

- profile trigger creates a row; `SupabaseProfileStore` round trip; invalid profile rejected;
- `SupabaseCredentialStore` read/modify/delete with a real bytea round trip; two concurrent `modify` calls (one wins, the other retries and sees the first's value);
- `workspace_put`: create, update with the right version, `PT409` with the current version on a stale one, cross-user chat id rejected (`23503`);
- `chats.claim` ownership;
- `access_request_submit`: inserted, duplicate, already_member, the 3-per-hour IP cap;
- artifacts upload, get, PDF cache, Storage cleanup on delete;
- the hook: `auth.admin.createUser` for a non-invited email fails with the hook's message (records claim 2);
- `disable_signup`: `signInWithOtp({ shouldCreateUser: true })` for an unknown `@example.test` email fails.

### RLS and grants tests (`agent/test/supabase/rls.int.test.ts`)

Users A and B with sessions, and a publishable-key client per user plus one with no session (anon):

- for every table in `public`, `select` as anon, A and B returns a permission error or 0 rows, including A's own rows;
- every `insert`, `update`, `delete` as A, B and anon on every table is denied;
- `rpc("workspace_put")` and `rpc("access_request_submit")` as A and anon → permission denied;
- Storage: A's client can't `list`, `download` or `upload` in `artifacts`;
- catalog check, sent with `SUPABASE_ACCESS_TOKEN` to `POST /v1/projects/{ref}/database/query/read-only`: every `public` table has `relrowsecurity = true`; the only policy in `public` is `invited_emails_auth_admin_read`; `has_table_privilege(role, t, 'select,insert,update,delete')` is false for `anon` and `authenticated` on every table; `has_function_privilege(role, f, 'execute')` is false for `anon` and `authenticated` on every function in `public`.

### End-to-end (local compose with Caddy, owner present for Google consent)

Prerequisites: migrations applied, `configure-auth.mjs --apply` (and `--disable-legacy-keys`), `.env-agent`, `.env-nextjs` and `.env-supabase-admin` filled in, Caddy root trusted, `bootstrap-admin.mjs ntnbhat9@gmail.com` run.

1. `docker compose --profile local up -d --build`; all services healthy. `curl --resolve agent.localhost:443:127.0.0.1 --cacert /tmp/caddy-root.crt -X POST https://agent.localhost/agui` → `401 unauthorized`. With `x-agent-secret` and no token → `401 signed_out`. `curl … https://agent.localhost/health` → 200 locally (the request reaches Caddy from the Docker bridge, a private range); the public 404 is checked on EC2 in the deploy steps.
2. In Chrome, open `https://app.localhost` → `/login`. **Continue with Google** as `ntnbhat9@gmail.com` (the owner does the consent). Land on `/`, onboarding starts, the header shows `header-admin-link`. DevTools → Application → Cookies: every `sb-*` cookie is HttpOnly, Secure, SameSite=Lax, no Domain.
3. Sign out, then on `/login` request an email link for `ntnbhat9@gmail.com`. The email arrives from `onboarding@resend.dev` (proves SMTP); open it, click **Continue**, land on `/` as the admin (same user id: proves Google and email resolve to one user).
4. In a second Chrome profile, open `/request-access` and submit `Dummy One / ntnbhat9+oab-e2e1@gmail.com / testing`. Thank-you page. Submit again: identical, and `/admin` → Requests → Pending shows "Showing 1–1 of 1".
5. As admin: **View** shows the details → **Approve**. Expect `invite_status='sent'` if the Resend sandbox accepts the plus-address, else `invite_status='failed'` with a visible error. Record which.
6. `node supabase/scripts/dev-link.mjs ntnbhat9+oab-e2e1@gmail.com` (dev-only, `.env-supabase-admin` loaded): if `profiles` has the email it calls `generateLink({ type: "magiclink", email, options: { redirectTo: APP_ORIGIN + "/auth/confirm" } })` and prints `…/auth/confirm?token_hash=<hashed_token>&type=email`; otherwise `generateLink({ type: "invite", … })` and prints `…&type=invite`. It never adds to `invited_emails`, so it only works for an approved request (the hook rejects anything else). Open it in the second profile, click **Continue**: signed in as the dummy with an empty profile.
7. As the dummy: finish onboarding, Models → OpenRouter, paste the OpenRouter key from `E2E_OPENROUTER_KEY`. The row shows `sk-or-…<last4>`. DevTools Network: no response contains the key. MCP `execute_sql`: `select provider, kind, hint, key_version, octet_length(ciphertext) from provider_credentials` shows ciphertext only.
8. As the dummy: run "price eggs and milk at Trader Joe's" (exercises `shop`, the workspace cart, and `create_artifact` when the model makes one; if not, ask "make that a printable list"). Open the artifact and download the PDF. Reload; the chat appears in Recent chats ("Showing 1–1 of 1") and reopens with its text.
9. Second dummy (`+oab-e2e2`, repeat 4–6). As dummy 2:
   - Recent chats is empty; Models shows OpenRouter not configured;
   - `fetch('/api/artifacts/<dummy 1 artifact id>')` in the console → 404;
   - `fetch('/api/chats/<dummy 1 chat id>/messages')` → 404;
   - an AG-UI run with dummy 1's `threadId` (set by hand in the console against `/api/copilotkit`) → `RUN_ERROR NOT_FOUND`;
   - `GET /api/profile` is dummy 2's own profile;
   - `document.cookie` in the console shows no `sb-*` cookie (HttpOnly).
10. As admin, **Deactivate** dummy 1. Dummy 1's next action within 30 s shows "Your access has been turned off". Reload → `/login`; email-link sign-in shows the neutral message and no email arrives; `dev-link.mjs` + Continue → `link_expired` (banned).
11. Google sign-in with a non-invited Google account (the owner's second account) → `/login?error=not_invited`; `select count(*) from auth.users` unchanged.
12. As admin, **Delete** dummy 1 and dummy 2 (type the email). Storage `artifacts/<id>/` is empty and every table has 0 rows for them.
13. `docker compose logs agent web caddy | grep -E "sk-|sb_secret|Bearer|refresh_token|eyJ"` returns nothing.
14. Cleanup: `node supabase/scripts/cleanup-e2e.mjs` deletes any remaining user whose email matches `ntnbhat9+oab-e2e%@gmail.com` or `%@example.test` (same delete flow, including Storage and `access_requests`), then prints the remaining user count (expected: 1, the admin; plus the eval user if created).

The builder records the run as a checklist in the PR description.

## Rollout and deploy

1. **Migrations.** Apply 1–6 with MCP `apply_migration`, then `list_migrations`, `get_advisors` (security, performance), then the RLS tests.
2. **Supabase config.** Create the `agent` and `admin_scripts` secret keys in the dashboard; delete the `default` secret key. `configure-auth.mjs --check`, `--apply`, then `--apply --disable-legacy-keys`.
3. **Admin.** `bootstrap-admin.mjs ntnbhat9@gmail.com`, then the local E2E and `cleanup-e2e.mjs`.
4. **EC2** (Ubuntu 24.04 or Amazon Linux 2023, t3.large or bigger for Chromium):
   - security group inbound 80/443 from anywhere, 22 from the owner's IP only;
   - `aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required --http-put-response-hop-limit 1`;
   - Docker with the compose plugin; `/etc/docker/daemon.json` log rotation (`"log-opts": { "max-size": "10m", "max-file": "5" }`); unattended security upgrades;
   - Elastic IP; DNS A record `<AGENT_HOST>` → Elastic IP;
   - clone the repo at the release commit; create `deploy-config/.env-agent` (same `CREDENTIAL_KEYS` and `ACCESS_REQUEST_PEPPER` as local, `APP_ORIGIN=https://<APP_HOST>`), `deploy-config/.env-caddy` (`AGENT_HOST`, `ACME_EMAIL`), `deploy-config/.env-search`; `chmod 600 deploy-config/.env-*`;
   - `CADDYFILE=Caddyfile.ec2 CADDY_BIND=0.0.0.0 docker compose up -d --build` (no `local` profile, so no web);
   - `curl -X POST https://<AGENT_HOST>/agui` → `401`; `curl https://<AGENT_HOST>/health` → 404.
5. **Vercel:** import the repo; Root Directory `web`; "Include files outside the root directory" on; Production env vars above (none for Preview); deploy. Note the plan: Hobby → keep `maxDuration = 300` and `RUN_TIME_LIMIT_SECONDS=280`; Pro → optionally `maxDuration = 800` in the route and `RUN_TIME_LIMIT_SECONDS=780` on EC2. Fluid compute must be on (Settings → Functions); without it Hobby caps at 60 s and runs would be cut early.
6. **Wire the origins.** Set `PROD_ORIGIN=https://<APP_HOST>` and `SITE_URL=https://<APP_HOST>` in `.env-supabase-admin`, rerun `configure-auth.mjs --apply`. Confirm `APP_ORIGIN` on EC2 matches; restart the agent.
7. **Production smoke test:** E2E steps 2, 7, 8, 11 against production with the owner and one dummy; then `cleanup-e2e.mjs`.
8. **Docs:** README "Run" → local compose + Caddy, TLS trust, env tables, admin bootstrap; remove the "no login" warnings (README line 24, SECURITY.md line 11) and describe the new model in SECURITY.md; add "Deploy" (this section). CONTRIBUTING layout gains `auth/`, `db/`, `crypto/`, `supabase/`.
9. **Commit cadence (owner rules):** a commit after each major step (migrations; agent auth; stores; crypto; web auth; admin; compose/Caddy; docs). `npm run build` in `agent` and `web` before each commit, rebuild and restart containers after each major change, self-review every diff, never commit `.env*`, keys or `.mcp.json`.

## Claims to verify during build

Each is checked by a named test, not assumed. Outcomes recorded 2026-11-01; "open" ones need the browser E2E run.

1. **Google linking to an invited user with `disable_signup = true`.** Open: E2E steps 2 and 6. If linking is refused, keep `disable_signup = true` and rely on email links for that user.
2. **Whether `before-user-created` fires for admin calls.** Settled (`agent/test/supabase/hook.int.test.ts`): it fires for `generateLink({ type: "invite" })` (a non-invited email is rejected with the hook's message) but **not** for `auth.admin.createUser`, which creates any email. Only `bootstrap-admin.mjs` and the integration tests call `createUser`, both with the secret key and after allowlisting; the agent never does. Public OTP sign-up with `shouldCreateUser: true` is refused (`signup_disabled`).
3. **Whether a failed invite email leaves the user created.** Open: E2E step 5. Both outcomes are handled: after a failed invite the agent looks the email up in `profiles` and stores `user_id` if the user exists.
4. **Resend sandbox and plus-addresses.** Open: E2E step 5.
5. **The Google callback error for a non-invited account.** Open: E2E step 11. Both `signup_disabled` and the hook's message map to `not_invited`.
6. **The hook URI in schema `private`.** Settled: the Management API accepted `pg-functions://postgres/private/before_user_created`, and the hook rejects non-invited `generateLink` calls, so it runs from `private`.
7. **Storage `allowed_mime_types` with the upload content type.** Settled (`repos.int.test.ts`): `text/html` and `application/pdf` uploads succeed.
8. **Nonce CSP with `cacheComponents`.** Settled by the docs: Next 16's CSP guide says Partial Prerendering can't carry nonces, so `cacheComponents` (and `partialPrefetching`, which needs it) are off and the root layout reads `x-nonce` from `headers()`. Every page is dynamic. Open: the Chrome console check for CSP violations in E2E.
9. **`sessions_timebox` / `sessions_inactivity_timeout` on the current plan.** Settled: the PATCH is rejected on this plan; `configure-auth.mjs --apply` skips both with "requires Pro plan" and `--check` reports them as not enforced instead of failing.
10. **Read-only agent container.** Partly settled: `pwuser` is uid/gid 1001 in `mcr.microsoft.com/playwright:v1.64.1-noble`; the agent starts and serves with `read_only: true` and the tmpfs mounts (`docker compose ps` healthy). Open: both Chromium paths under E2E step 8.
11. **Banned user and `verifyOtp`.** Open: E2E step 10. The agent side is settled: a deactivated user's still-valid token gets `403 account_disabled` (checked against the running stack).

Resolved during review (no longer open): auth field names and units (`sessions_*` in hours, `jwt_exp` and `security_refresh_token_reuse_interval` in seconds, `smtp_port` a string); CopilotKit per-request agents (`AgentsFactory`) and default header forwarding; pi `CredentialStore` signature and env fallback; `contextNote` can be async (pi's `context` handler accepts a Promise); pi's ChatGPT callback port is fixed at 1455; `@supabase/ssr` honors `cookieOptions.httpOnly`; `supabase_auth_admin` already has `USAGE` on `public`.

## Decisions made by the owner (formerly open questions)

1. **One Supabase project for local and production** — decided: use `dwiuzfvmevdzzabqeaog` for both. Local test users are real users and are deleted after each E2E run (`cleanup-e2e.mjs`). `CREDENTIAL_KEYS` and `ACCESS_REQUEST_PEPPER` are shared. A separate development project is a later step.
2. **Operator LiteLLM gateway and private-network provider URLs** — decided: admin-only.
3. **Domains** — decided: unknown for now. Everything reads `APP_ORIGIN`, `AGENT_HOST`, `SITE_URL`, `PROD_ORIGIN` from env, with `<APP_HOST>` / `<AGENT_HOST>` placeholders in docs; local uses `app.localhost` / `agent.localhost`. Deploy steps are above.
4. **Vercel plan** — decided: unknown; design works on both. `maxDuration = 300` plus the agent's `RUN_TIME_LIMIT_SECONDS = 280`; Pro may raise to 800/780.
5. **Bot protection** — decided: honeypot, signed fill time and rate limits now; Turnstile later.

## Later steps (documented, not built)

- **Second Supabase project for development.** Create a free project, run the migrations and `configure-auth.mjs` against it (`SUPABASE_PROJECT_REF`), give local its own `CREDENTIAL_KEYS` and pepper, and point `.env-agent` / `.env-nextjs` at it.
- **Verified Resend domain.** Add SPF/DKIM in Resend, set `SMTP_SENDER_EMAIL` (e.g. `hello@<domain>`), optionally a domain-scoped `RESEND_API_KEY`, rerun `configure-auth.mjs --apply --rotate-secrets`. No code change.
- **Cloudflare Turnstile on request-access.** Site key in Vercel (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`), secret in `.env-agent` (`TURNSTILE_SECRET_KEY`), verified by the agent in `POST /access-requests` before `access_request_submit`; `connect-src`/`script-src`/`frame-src` gain `https://challenges.cloudflare.com`.
- **AWS KMS** for the master key (`KmsKeyWrapper`).
- **Persisting widget payloads** for reopened chats (`chat_messages.parts jsonb`).

## UI copy and styling

Exact copy beyond the strings fixed above, and the admin and recent-chats styling, follow the existing glass style and are the builder's only open choices.

## Build notes (2026-11-01)

What the build changed or learned, beyond the claims above.

- **Ambient env names** are collected at startup by asking every pi built-in provider's `auth.apiKey.resolve()` which variables it reads (a recording `AuthContext`), because pi doesn't export the names as data. The list includes config-like names such as `GOOGLE_CLOUD_PROJECT`; any of them set makes startup fail.
- **Jev** is resolved per user hub (a `WeakMap` cache) with one shared limiter (`createJudge({ limiter })`) so `JEV_CONCURRENCY` stays global.
- **Error bodies** are `{ error: <code>, message }` everywhere; `UserError` gained an optional `code` and `details`, and kinds `unprocessable` (422 `invalid`), `unauthorized`, `forbidden`, `too_large`, `rate_limited` and `internal` (500, used by `delete_failed`).
- **Two runs at once per user**: a third concurrent `POST /agui` gets `429` with `retryAfter: 5`.
- **Web (CopilotKit)**: the runtime's `InMemoryAgentRunner` keys threads by bare id and exposes `GET /threads` listing every thread, so the route uses a `UserScopedRunner` (`web/lib/copilotRunner.ts`) keyed by `${userId}:${threadId}` with thread listing off. The CopilotKit provider moved from the root layout into `app/page.tsx` so `/login` and `/admin` render without it. Admin list reads are server actions (`app/admin/actions.ts`) rather than `/api/admin/*` routes; both check the claim and the agent checks again.
- **Web (sign-out)**: when Supabase can't be reached, the sign-out route deletes the `sb-*` cookies itself and redirects to `/login?error=auth_unavailable`. A missing env var throws a named `ConfigError`, never `agent_unreachable`. `x-client-ip` is sent only when the first `x-forwarded-for` entry looks like an IP; the agent uses `unknown` otherwise.
- **Pending owner actions** (the build's permissions refused these; nothing depends on them yet):
  - delete the `default` secret API key (`6ec4aaf1-…`);
  - `node supabase/scripts/configure-auth.mjs --apply --disable-legacy-keys` (disables the legacy anon/service_role keys and revokes the legacy HS256 secret; the Supabase MCP talks to the Management API with the owner's token and doesn't use them);
  - `docker volume rm open-agent-bot_agent-data open-agent-bot_artifacts-data open-agent-bot_shared` (the old file-store volumes; compose no longer mounts them).


## Review fixes (2026-11-01)

Two reviews (security and code) after the build. What changed:

- **Persistence.** `db/database.types.ts` is generated (`node supabase/scripts/gen-types.mjs`, Management API) and the clients are `SupabaseClient<Database>`; row mappers narrow text columns with `oneOf`. The client wraps `fetch` with a 10 s timeout, which also covers Storage and `auth.admin`; postgrest's own retries are off so `read()`'s single retry is the only one. Paging helpers live in `db/rows.ts`. `updateRequest` tells `not_found` from `already_decided`. Provider settings reads never write (the row is created once if missing) and saves are guarded by `updated_at`, so a stale hub gets `409 settings_changed` and is rebuilt. Artifact removal moved to `AdminRepo.storage.removeUserFiles`; `admin/deleteAccount.ts` is the one delete sequence (service, tests; `admin.mjs` is held to the same order by a unit test). Rotation pages with a keyset cursor (`crypto/rotate.ts`).
- **Contracts in `shared/`.** `ids.ts` (`isUuid`, `normalizeId`), `email.ts`, `pages.ts` (`PAGE_SIZE`, `Page`, `PageResponse`), `admin.ts`, `chats.ts`. Ids are normalized at every HTTP boundary, so upper-case ids can't dodge the self-action check or cache invalidation.
- **Errors.** Every agent error, rate limits and the guards included, goes through `errorResponse(UserError)`. Admin rate limits apply to `/admin/*` only; unknown paths are `404 not_found`. Web maps auth and reachability failures in one place (`authFailureOf`, `unreachableOf`). Run auth failures use the JSON `error` code, not a regex.
- **Runs.** `runId` must match `^[\w-]{1,100}$`; the logger escapes control characters in every string argument. A message or reply that couldn't be saved emits a `not_saved` custom event before the run ends and the chat shows it. Session creation registers the pending entry before making room, so concurrent opens share one session and never exceed the per-user cap.
- **Admin.** Approving a request from an existing member marks it approved and returns `200` with `inviteStatus: null` ("They already have an account, so no invite was sent."). Lists reload after every action (`usePagedAdminList`) and step back to the last page when a page empties.
- **Supabase settings applied** with `configure-auth.mjs --apply`: password-reauth flags, password-change notifications, MFA off, the custom access token hook (migration `20261101073603_no_password_tokens`), templates with `&email=`. Pro-only fields (`sessions_*`, `password_hibp_enabled`) are reported, not enforced.
- **Pending owner action:** `node supabase/scripts/configure-auth.mjs --apply --disable-legacy-keys` (revokes the HS256 key, disables legacy anon/service_role, deletes the unused `default` secret key). `--check` exits 1 until then.
- **Dependencies.** undici, zod and minimatch pinned to fixed versions via overrides in the agent (audit clean). Web: CopilotKit 1.83, scoped undici override, graphql-scalars 2; what remains (zod 3 inside CopilotKit/ag-ui, `@hono/node-server` 1.x `serveStatic`, katex) has no compatible fix and isn't reachable in our use.
