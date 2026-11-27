-- Social Manager → Inbox. Comments and messages from the company's social
-- accounts in one work queue: needs reply, assigned to someone, snoozed, done.
-- Items arrive from the Companion (first: the comments its automatic
-- Instagram/Facebook updates already see). Replies are written on the
-- platform itself; "Reply" opens the original conversation.
-- Accessed only through the authenticated website routes, never by browsers.

create table if not exists public.social_inbox_items (
  id             text primary key,
  workspace_id   text not null references public.platform_workspaces(id) on delete cascade,
  platform       text not null check (platform in ('instagram', 'facebook', 'youtube', 'linkedin', 'x')),
  kind           text not null default 'comment' check (kind in ('comment', 'reply', 'message', 'mention')),
  -- Stable id from the platform, or a fingerprint of post + author + text.
  external_id    text not null,
  author_name    text not null default '',
  author_url     text not null default '',
  body           text not null default '',
  -- What it was said on: the post's caption, or the conversation.
  context_text   text not null default '',
  -- Where to reply: the post, comment or conversation on the platform.
  permalink      text not null default '',
  received_at    timestamptz,
  status         text not null default 'open' check (status in ('open', 'done')),
  assigned_to    text references public.platform_users(id) on delete set null,
  snoozed_until  timestamptz,
  note           text not null default '',
  done_by        text references public.platform_users(id) on delete set null,
  done_at        timestamptz,
  source         text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, platform, external_id)
);
create index if not exists social_inbox_items_queue_idx
  on public.social_inbox_items (workspace_id, status, received_at desc);
create index if not exists social_inbox_items_assignee_idx
  on public.social_inbox_items (workspace_id, assigned_to) where status = 'open';

create table if not exists public.social_inbox_saved_replies (
  id            text primary key,
  workspace_id  text not null references public.platform_workspaces(id) on delete cascade,
  title         text not null,
  body          text not null,
  created_by    text references public.platform_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists social_inbox_saved_replies_workspace_idx
  on public.social_inbox_saved_replies (workspace_id, title);

alter table public.social_inbox_items enable row level security;
alter table public.social_inbox_saved_replies enable row level security;
revoke all on public.social_inbox_items, public.social_inbox_saved_replies from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.social_inbox_items, public.social_inbox_saved_replies from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.social_inbox_items, public.social_inbox_saved_replies from authenticated;
  end if;
end $$;

-- The nightly analytics update now also brings each post's latest comments,
-- which feed the inbox. Same as before except skip_comments.
create or replace function private.social_analytics_sync_payload(source public.social_analytics_sources)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'source', 'social-analytics',
    'sourceId', source.id,
    'mode', 'profile_url',
    'query', source.profile_url,
    'profile_type', 'page',
    'collection_mode', 'latest',
    'max_results', 50,
    'recent_days', 365,
    'skip_comments', false,
    'timezone_offset_minutes', source.timezone_offset_minutes
  )
$$;
