-- Per-workspace Google OAuth grants. Tokens are encrypted by the application;
-- this table is accessible only to the platform server role.
create table if not exists public.ai_phone_front_desk_google_connections (
  workspace_id text not null references public.platform_workspaces(id) on delete cascade,
  kind text not null check (kind in ('calendar', 'mail')),
  google_email text not null,
  refresh_token_ciphertext text not null,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  granted_scopes text not null,
  calendar_id text not null default '',
  time_zone text not null default 'UTC',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, kind)
);

alter table public.ai_phone_front_desk_google_connections enable row level security;
revoke all on public.ai_phone_front_desk_google_connections from public, anon, authenticated;
