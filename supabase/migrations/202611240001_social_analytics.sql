-- Social Media Manager → Analytics. Each company uploads the analytics files
-- its social platforms let it export (Meta Business Suite for Instagram and
-- Facebook, YouTube Studio, LinkedIn, X). Every post's latest numbers are kept
-- here; uploading a newer export updates them. No platform login or API is used.
-- Accessed only through the authenticated website routes, never by browsers.

create table if not exists public.social_analytics_imports (
  id            text primary key,
  workspace_id  text not null references public.platform_workspaces(id) on delete cascade,
  platform      text not null check (platform in ('instagram', 'facebook', 'youtube', 'linkedin', 'x')),
  file_name     text not null,
  post_count    integer not null default 0,
  imported_by   text references public.platform_users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists social_analytics_imports_workspace_idx
  on public.social_analytics_imports (workspace_id, created_at desc);

create table if not exists public.social_analytics_posts (
  id              text primary key,
  workspace_id    text not null references public.platform_workspaces(id) on delete cascade,
  platform        text not null check (platform in ('instagram', 'facebook', 'youtube', 'linkedin', 'x')),
  -- The platform's post id, else its link, else a fingerprint of text and time.
  post_key        text not null,
  account         text not null default '',
  permalink       text not null default '',
  post_text       text not null default '',
  post_type       text not null default '',
  published_at    timestamptz,
  -- views, reach, impressions, likes, comments, shares, saves, clicks, follows, watchHours
  metrics         jsonb not null default '{}'::jsonb,
  import_id       text references public.social_analytics_imports(id) on delete set null,
  updated_at      timestamptz not null default now()
);
create unique index if not exists social_analytics_posts_key_idx
  on public.social_analytics_posts (workspace_id, platform, post_key);
create index if not exists social_analytics_posts_published_idx
  on public.social_analytics_posts (workspace_id, published_at desc);

alter table public.social_analytics_imports enable row level security;
alter table public.social_analytics_posts enable row level security;
revoke all on public.social_analytics_imports from public;
revoke all on public.social_analytics_posts from public;
-- The Supabase API roles exist only on Supabase-hosted databases (not on Hetzner).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.social_analytics_imports, public.social_analytics_posts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.social_analytics_imports, public.social_analytics_posts from authenticated;
  end if;
end $$;
