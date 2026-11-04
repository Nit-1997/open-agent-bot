-- Accepted advisor findings: rls_enabled_no_policy (INFO) on every public table except
-- invited_emails. The agent's secret key is the only data path; anon and authenticated get nothing.
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
