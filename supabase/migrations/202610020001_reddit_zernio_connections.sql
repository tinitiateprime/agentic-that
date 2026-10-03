-- Reddit publishing moves to Zernio (https://zernio.com), which holds the Reddit
-- OAuth grant. AgenticThat keeps only Zernio ids, so the token columns from
-- 202609270001 are dropped with their table. No production rows existed yet.

drop table if exists public.publishing_reddit_connections;

-- One Zernio profile groups the connected social accounts of one workspace.
create table if not exists public.publishing_zernio_profiles (
  workspace_id text primary key references public.platform_workspaces(id) on delete cascade,
  profile_id text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.publishing_reddit_connections (
  workspace_id text not null references public.platform_workspaces(id) on delete cascade,
  account_id text not null,
  zernio_profile_id text not null,
  zernio_account_id text not null,
  reddit_username text not null default '',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, account_id)
);

alter table public.publishing_zernio_profiles enable row level security;
alter table public.publishing_reddit_connections enable row level security;
revoke all on public.publishing_zernio_profiles from public, anon, authenticated;
revoke all on public.publishing_reddit_connections from public, anon, authenticated;
